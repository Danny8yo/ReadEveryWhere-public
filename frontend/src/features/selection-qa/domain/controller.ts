import { qaReason } from "./messages";
import { errorMessage } from "../../../shared/domain/errors";
import {
  isActive,
  type QaApi,
  type Conversation,
  type Turn,
  type SelectionRequest,
  type LoadedEpubIdentity,
  type PendingCommand,
  type ApplyResult,
  type ApplyTarget,
} from "../model/selectionQa";
import type { Annotation } from "../../reader/model/annotation";
import {
  reduceEvent,
  verifyLoadedLocation,
  plainAnswer,
  renderedAnswer,
  assertLoadedScope,
} from "./protocol";
export function createQaState() {
  return {
    open: false,
    busy: false,
    error: null as string | null,
    notice: null as string | null,
    question: "",
    selection: null as SelectionRequest | null,
    conversation: null as Conversation | null,
    conversations: [] as Conversation[],
    conversationCursor: null as string | null,
    turns: [] as Turn[],
    turnCursor: null as number | null,
    pending: null as PendingCommand | null,
    streamStatus: "idle" as "idle" | "connected" | "reconnecting",
    preview: null as {
      turnId: string;
      text: string;
      targetId: string;
      annotations: Annotation[];
      originalCfi: string;
      conflict: boolean;
      answerVersion?: number;
      requiresUnverifiedConfirmation?: boolean;
      acceptUnverified?: boolean;
    } | null,
  };
}
export interface QaHost {
  identity: () => LoadedEpubIdentity | null;
  commandId: () => string;
  navigate: (cfi: string) => Promise<void>;
  changed: () => Promise<void>;
  later: (fn: () => void, ms: number) => () => void;
  savePending: (command: PendingCommand | null) => void;
  loadPending: () => PendingCommand | null;
}
export function createQaController(
  state: ReturnType<typeof createQaState>,
  bookId: number,
  api: QaApi,
  host: QaHost,
) {
  let token = 0,
    disposed = false,
    unsubscribe: (() => void) | null = null,
    cancelRetry: (() => void) | null = null;
  function disconnect() {
    unsubscribe?.();
    unsubscribe = null;
    cancelRetry?.();
    cancelRetry = null;
    state.streamStatus = "idle";
  }
  function errorCode(error: unknown): string {
    if (!error || typeof error !== "object") return "";
    const value = error as { code?: unknown; details?: { reason?: unknown } };
    return typeof value.details?.reason === "string"
      ? value.details.reason
      : typeof value.code === "string"
        ? value.code
        : "";
  }
  function report(error: unknown) {
    const text = errorCode(error);
    state.error = text ? qaReason(text) : errorMessage(error);
    if (
      /CONTENT_VERSION_CHANGED|CONVERSATION_FROZEN|CONTENT_REVISION_MISMATCH/.test(
        text,
      ) &&
      state.conversation
    )
      state.conversation.status = "frozen";
  }
  async function action(operation: () => Promise<void>) {
    if (state.busy || disposed) return;
    state.busy = true;
    state.error = null;
    const actionToken = token;
    try {
      await operation();
    } catch (error) {
      if (actionToken === token) report(error);
    } finally {
      if (actionToken === token) state.busy = false;
    }
  }
  function setPending(command: PendingCommand | null) {
    host.savePending(command);
    state.pending = command;
  }
  function bind() {
    disconnect();
    const turn = state.turns.find(isActive);
    if (!state.open || !turn || disposed) return;
    const selectedToken = token;
    state.streamStatus = "connected";
    const reconnect = () => {
      if (selectedToken !== token || disposed || !state.open) return;
      disconnect();
      state.streamStatus = "reconnecting";
      cancelRetry = host.later(() => {
        void refresh().catch((error) => {
          report(error);
          reconnect();
        });
      }, 1000);
    };
    unsubscribe = api.subscribe(turn.id, turn.lastSequence, {
      event: (event) => {
        if (selectedToken !== token || disposed) return;
        try {
          const result = reduceEvent(turn, event);
          if (result === "gap") {
            reconnect();
            return;
          }
          if (!isActive(turn)) disconnect();
        } catch (error) {
          report(error);
          reconnect();
        }
      },
      error: (error) => {
        if (selectedToken === token) {
          report(error);
          reconnect();
        }
      },
      end: () => {
        if (selectedToken === token && isActive(turn)) reconnect();
      },
    });
  }
  async function allTurns(id: string) {
    let cursor: number | undefined;
    const items: Turn[] = [];
    do {
      const page = await api.turns(id, cursor);
      items.push(...page.items);
      if (
        page.nextCursor !== null &&
        cursor !== undefined &&
        page.nextCursor <= cursor
      )
        throw new Error("问答分页游标未前进。");
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return items;
  }
  async function refresh() {
    const conversation = state.conversation;
    if (!conversation) return;
    const selectedToken = token;
    const current = await api.conversation(conversation.id);
    const items = await allTurns(conversation.id);
    if (selectedToken !== token || disposed) return;
    state.conversation = current;
    state.turns = items;
    state.turnCursor = null;
    bind();
  }
  async function list(more = false) {
    const selectedToken = token;
    const page = await api.conversations(
      bookId,
      more ? (state.conversationCursor ?? undefined) : undefined,
    );
    if (disposed || selectedToken !== token) return;
    state.conversations = more
      ? [...state.conversations, ...page.items]
      : page.items;
    state.conversationCursor = page.nextCursor;
  }
  async function select(id: string) {
    disconnect();
    const selectedToken = token;
    state.selection = null;
    state.preview = null;
    state.question = "";
    const conversation = await api.conversation(id);
    const items = await allTurns(id);
    if (selectedToken !== token || disposed) return;
    state.conversation = conversation;
    state.turns = items;
    state.turnCursor = null;
    bind();
  }
  async function open(selection?: SelectionRequest) {
    state.open = true;
    state.error = null;
    if (selection) {
      token++;
      state.busy = false;
      disconnect();
      state.selection = selection;
      state.conversation = null;
      state.turns = [];
      state.turnCursor = null;
      state.preview = null;
      state.question = "";
    }
    await action(async () => {
      state.pending = host.loadPending();
      await list();
      if (!selection && state.conversation) await refresh();
    });
  }
  function close() {
    state.open = false;
    state.busy = false;
    token++;
    disconnect();
  }
  async function executePending() {
    const command = state.pending;
    if (!command) return;
    const commandToken = token;
    let result: Awaited<ReturnType<QaApi["execute"]>>;
    try {
      result =
        command.kind === "apply"
          ? ((await api.receipt(command.body.commandId)) ??
            (await api.execute(command)))
          : await api.execute(command);
    } catch (error) {
      const encoded = errorCode(error);
      if (commandToken !== token || disposed) throw error;
      if (
        /ANNOTATION_CONFLICT|revision_conflict|ANNOTATION_NOT_FOUND/.test(
          encoded,
        )
      ) {
        if (state.preview) {
          const draft = state.preview;
          const annotations = await api.annotations(bookId);
          if (commandToken !== token || disposed) return;
          draft.conflict = true;
          draft.annotations = annotations;
        }
        if (state.pending?.body.commandId === command.body.commandId)
          setPending(null);
      } else if (command.kind === "create" && /^(CONTENT_REVISION_MISMATCH|LOCATOR_INVALID|LOCATOR_OUT_OF_RANGE|TEXT_QUOTE_MISMATCH|BOOK_NOT_FOUND|BOOK_FILE_MISSING|UNSUPPORTED_FORMAT|EXTRACTION_FAILED)$/.test(encoded)) {
        // Creation rejected the selection before committing any command receipt.
        setPending(null);
      } else if (
        /CONTENT_VERSION_CHANGED|CONVERSATION_FROZEN|TURN_NOT_APPLICABLE|MODEL_NOT_CONFIGURED|INVALID_SELECTION|ANNOTATION_SELECTION_INVALID|COMMAND_PAYLOAD_MISMATCH|ACTIVE_TURN_EXISTS/.test(
          encoded,
        )
      ) {
        setPending(null);
      }
      throw error;
    }
    if (state.pending?.body.commandId === command.body.commandId)
      setPending(null);
    if (commandToken !== token || disposed) return;
    if (command.kind === "apply") {
      const applied = result as ApplyResult;
      state.notice = applied.replayed
        ? "已确认此操作先前成功，未再次追加。"
        : "已保存到批注。";
      if (!applied.currentAnnotation)
        state.notice += " 当前批注已删除，未恢复它。";
      state.preview = null;
      await host.changed();
    } else {
      state.notice = null;
      state.question = "";
      const conversationId =
        command.kind === "create"
          ? (result as { conversation: Conversation }).conversation.id
          : command.conversationId;
      try {
        await select(conversationId);
      } catch (error) {
        if (errorCode(error) === "CONVERSATION_NOT_FOUND")
          state.notice = "原对话已删除；已确认上次提交成功，不会重新创建。";
        throw error;
      }
      await list();
    }
  }
  async function send(retryOfTurnId?: string) {
    await action(async () => {
      if (state.pending)
        throw new Error("上次提交结果尚未确认，请先重试核对。");
      const scope =
        state.conversation?.selection.scope ?? state.selection?.scope;
      if (scope) assertLoadedScope(bookId, host.identity(), scope);
      const question = retryOfTurnId
        ? state.turns.find((t) => t.id === retryOfTurnId)?.question
        : state.question;
      if (!question?.trim() || question.length > 4000)
        throw new Error("问题不能为空，且最多 4000 字符。");
      if (state.conversation) {
        if (state.conversation.status === "frozen")
          throw new Error("旧版本会话仅供查看，请重新选文创建对话。");
        if (state.turns.some(isActive) || state.turnCursor !== null)
          throw new Error("请先停止当前回答，或加载后续轮次。");
        setPending({
          kind: "turn",
          conversationId: state.conversation.id,
          body: {
            commandId: host.commandId(),
            question,
            ...(retryOfTurnId ? { retryOfTurnId } : {}),
          },
        });
      } else {
        if (!state.selection)
          throw new Error("请在 EPUB 正文中选择文字，再点击“询问 AI”。");
        const selected = state.selection;
        setPending({
          kind: "create",
          body: {
            commandId: host.commandId(),
            bookId,
            selection: selected,
            question,
          },
        });
      }
      await executePending();
    });
  }
  async function jump(turnId?: string, evidenceId?: string) {
    await action(async () => {
      if (!state.conversation) throw new Error("请先打开对话。");
      const selectedToken = token;
      const location = await api.location(
        state.conversation.id,
        turnId,
        evidenceId,
      );
      const cfi = verifyLoadedLocation(bookId, host.identity(), location);
      if (selectedToken === token) await host.navigate(cfi);
    });
  }
  async function preview(turnId: string, selectedText?: string) {
    await action(async () => {
      if (state.pending) throw new Error("请先核对上次提交结果。");
      const conversation = state.conversation,
        turn = state.turns.find((t) => t.id === turnId);
      if (!conversation || !turn || isActive(turn) || !turn.answer.trim())
        throw new Error("请先停止回答，再预览已生成的内容。");
      const previewToken = token;
      const location = await api.location(conversation.id);
      const originalCfi = verifyLoadedLocation(
        bookId,
        host.identity(),
        location,
      );
      const annotations = await api.annotations(bookId);
      if (previewToken !== token || disposed || !state.open) return;
      const selected = selectedText || turn.answer;
      if (selectedText && !renderedAnswer(turn).replace(/\s+/g, " ").includes(selectedText.replace(/\s+/g, " ")))
        throw new Error("所选内容不属于此回答。");
      state.preview = {
        turnId,
        text: selectedText ? selectedText : plainAnswer(turn, selected),
        targetId: "new",
        annotations,
        originalCfi,
        conflict: false,
        answerVersion: turn.answerVersion,
        requiresUnverifiedConfirmation: turn.status !== "completed",
        acceptUnverified: false,
      };
    });
  }
  async function apply() {
    await action(async () => {
      const draft = state.preview;
      if (!draft) return;
      if (state.pending) throw new Error("请先核对上次提交结果。");
      if (!draft.text.trim() || draft.text.length > 50000)
        throw new Error("追加文字不能为空，且最多 50000 字符。");
      if (draft.conflict) throw new Error("请核对最新原批注，并明确重新确认。");
      const turn = state.turns.find(t => t.id === draft.turnId);
      if (!turn || isActive(turn) || turn.answerVersion !== draft.answerVersion) throw new Error("回答版本已变化，请重新预览。");
      if (draft.requiresUnverifiedConfirmation && draft.acceptUnverified !== true) throw new Error("请明确确认此回答尚未完成或核验。");
      const target: ApplyTarget =
        draft.targetId === "new"
          ? {
              kind: "create",
              annotationType: "highlight",
              color: "#ffeb3b",
              cfi: draft.originalCfi,
            }
          : (() => {
              const current = draft.annotations.find(
                (a) => a.id === draft.targetId,
              );
              if (!current)
                throw new Error("目标批注已删除，请明确选择新建或其他批注。");
              return {
                kind: "append" as const,
                annotationId: current.id,
                expectedRevision: current.revision,
              };
            })();
      setPending({
        kind: "apply",
        turnId: draft.turnId,
        body: { commandId: host.commandId(), appendText: draft.text, target,
          ...(draft.answerVersion !== undefined ? { answerVersion: draft.answerVersion } : {}),
          ...(draft.requiresUnverifiedConfirmation ? { acceptUnverified: true } : {}),
        },
      });
      await executePending();
    });
  }
  return {
    unavailableReason: () => {
      const scope =
        state.conversation?.selection.scope ?? state.selection?.scope;
      try {
        if (!host.identity())
          return "当前浏览器尚未完成 EPUB 文件身份校验，问答暂不可用；历史记录仍可查看。";
        if (scope) assertLoadedScope(bookId, host.identity(), scope);
        return null;
      } catch (error) {
        return errorMessage(error);
      }
    },
    open,
    close,
    send,
    jump,
    preview,
    apply,
    retryPending: () => action(executePending),
    select: (id: string) => {
      token++;
      state.busy = false;
      disconnect();
      return action(() => select(id));
    },
    listMore: () => action(() => list(true)),
    refresh: () => action(refresh),
    moreTurns: () => action(refresh),
    stop: () =>
      action(async () => {
        const stopToken = token;
        const turn = state.turns.find(isActive);
        if (turn) {
          await api.stop(turn.id);
          if (stopToken === token && !disposed) await refresh();
        }
      }),
    delete: () =>
      action(async () => {
        const conversation = state.conversation,
          deleteToken = token;
        if (!conversation) return;
        if (state.turns.some(isActive))
          throw new Error("请先停止回答再删除对话。");
        await api.delete(conversation.id);
        if (deleteToken !== token || disposed) return;
        disconnect();
        state.conversation = null;
        state.turns = [];
        await list();
      }),
    reconfirm: () => {
      if (state.preview) state.preview.conflict = false;
    },
    dispose: () => {
      disposed = true;
      token++;
      disconnect();
    },
  };
}
