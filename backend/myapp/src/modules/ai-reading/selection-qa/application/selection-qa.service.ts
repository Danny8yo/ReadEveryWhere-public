import { QA_POLICY } from "./selection-qa-runtime.port";
import type { QaModelPort } from "./selection-qa-runtime.port";
import {
  AnnotationApplicationPort,
  ApplyAnnotationInput,
} from "./annotation-application.port";
import { createHash, randomUUID } from "node:crypto";
import {
  Conversation,
  SelectionQaContentPort,
  SelectionQaError,
  SelectionQaStore,
  Turn,
} from "./selection-qa.types";
export function commandDigest(value: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => [key, stable(value)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}
export class SelectionQaService {
  constructor(
    private readonly store: SelectionQaStore,
    private readonly content: SelectionQaContentPort,
    private readonly annotations: AnnotationApplicationPort,
    private readonly models: Pick<QaModelPort, "snapshot">,
  ) {}
  resolve(userId: number, bookId: number, selection: unknown) {
    return this.content.resolve(userId, bookId, selection);
  }
  async create(
    userId: number,
    input: {
      commandId: string;
      bookId: number;
      selection: unknown;
      question: string;
    },
  ) {
    const digest = commandDigest({ operation: "create", ...input });
    const receipt = this.store.receipt(userId, input.commandId, digest);
    if (receipt !== null) return receipt;
    const selection = await this.content.resolve(
      userId,
      input.bookId,
      input.selection,
    );
    return this.store.transact(() => {
      const replay = this.store.receipt(userId, input.commandId, digest);
      if (replay !== null) return replay;
      this.content.assertCurrent(userId, selection);
      const now = Date.now();
      const conversation: Conversation = {
        id: randomUUID(),
        userId,
        bookId: input.bookId,
        selection,
        status: "active",
        frozenReason: null,
        firstQuestion: input.question,
        createdAt: now,
        updatedAt: now,
      };
      this.store.createConversation(conversation);
      const turn = this.newTurn(
        userId,
        conversation.id,
        1,
        input.question,
        null,
      );
      this.store.createTurn(turn, this.models.snapshot(userId));
      const result = { conversation, turn: this.store.turn(userId, turn.id) };
      this.store.saveReceipt(userId, input.commandId, digest, result);
      return result;
    });
  }
  addTurn(
    userId: number,
    id: string,
    input: { commandId: string; question: string; retryOfTurnId?: string },
  ) {
    const digest = commandDigest({
      operation: "turn",
      conversationId: id,
      ...input,
    });
    const result = this.store.transact(() => {
      const receipt = this.store.receipt(userId, input.commandId, digest);
      if (receipt !== null) return { value: receipt };
      const conversation = this.store.conversation(userId, id);
      if (!this.current(userId, conversation))
        return { error: new SelectionQaError("CONVERSATION_FROZEN") };
      if (this.store.activeTurn(userId, id))
        throw new SelectionQaError("ACTIVE_TURN_EXISTS");
      if (input.retryOfTurnId) {
        const old = this.store.turn(userId, input.retryOfTurnId);
        if (
          old.conversationId !== id ||
          ["queued", "running"].includes(old.status)
        )
          throw new SelectionQaError("INVALID_RETRY_TARGET");
      }
      const turn = this.newTurn(
        userId,
        id,
        this.store.nextTurnNumber(userId, id),
        input.question,
        input.retryOfTurnId ?? null,
      );
      this.store.createTurn(turn, this.models.snapshot(userId));
      const value = this.store.turn(userId, turn.id);
      this.store.saveReceipt(userId, input.commandId, digest, value);
      return { value };
    });
    if ("error" in result) throw result.error;
    return result.value;
  }
  get(userId: number, id: string) {
    return this.store.transact(() => {
      const conversation = this.store.conversation(userId, id);
      this.current(userId, conversation);
      return this.store.conversation(userId, id);
    });
  }
  list(
    userId: number,
    bookId: number,
    cursor: string | undefined,
    limit: number,
  ) {
    return this.store.transact(() => {
      const rows = this.store.conversations(userId, bookId, cursor, limit + 1);
      const items = rows.slice(0, limit).map((row) => {
        this.current(userId, row);
        return this.store.conversation(userId, row.id);
      });
      const last = items[items.length - 1];
      return {
        items,
        nextCursor:
          rows.length > limit
            ? Buffer.from(JSON.stringify([last.createdAt, last.id])).toString(
                "base64url",
              )
            : null,
      };
    });
  }
  turns(userId: number, id: string, after: number, limit: number) {
    this.get(userId, id);
    const rows = this.store.turns(userId, id, after, limit + 1);
    return {
      items: rows.slice(0, limit),
      nextCursor: rows.length > limit ? rows[limit - 1].turnNumber : null,
    };
  }
  subscribe(userId: number, id: string, listener: () => void) {
    this.store.turn(userId, id);
    return this.store.subscribe(userId, id, listener);
  }
  events(userId: number, id: string, after: number) {
    const turn = this.store.turn(userId, id);
    this.get(userId, turn.conversationId);
    return this.store.events(userId, id, after);
  }
  stop(userId: number, id: string) {
    return this.store.transact(() => this.store.stop(userId, id));
  }
  delete(userId: number, id: string) {
    return this.store.transact(() => {
      this.store.conversation(userId, id);
      if (this.store.activeTurn(userId, id))
        throw new SelectionQaError("ACTIVE_TURN_EXISTS");
      this.store.delete(userId, id);
      return { deleted: true };
    });
  }
  async apply(userId: number, turnId: string, input: ApplyAnnotationInput) {
    const digest = commandDigest({ operation: "apply", turnId, ...input });
    const receipt = this.annotations.findReceipt(
      userId,
      input.commandId,
      digest,
    );
    if (receipt !== null) return receipt;
    const turn = this.store.turn(userId, turnId);
    if (
      ["queued", "running"].includes(turn.status) ||
      turn.answer.trim().length === 0
    )
      throw new SelectionQaError("TURN_NOT_APPLICABLE");
    if (turn.answerVersion !== undefined && input.answerVersion !== turn.answerVersion)
      throw new SelectionQaError("ANSWER_VERSION_MISMATCH");
    if (turn.status !== "completed" && input.acceptUnverified !== true)
      throw new SelectionQaError("UNVERIFIED_ANSWER_CONFIRMATION_REQUIRED");
    const conversation = this.get(userId, turn.conversationId);
    if (conversation.status === "frozen")
      throw new SelectionQaError("CONVERSATION_FROZEN");
    return this.annotations.execute(userId, {
      ...input,
      requestDigest: digest,
      selection: conversation.selection,
    });
  }
  receipt(userId: number, id: string) {
    const receipt = this.annotations.findReceipt(userId, id);
    if (receipt === null) throw new SelectionQaError("COMMAND_NOT_FOUND", 404);
    return receipt;
  }
  getTurn(userId: number, id: string) {
    return this.store.turn(userId, id);
  }
  private current(userId: number, conversation: Conversation): boolean {
    if (conversation.status === "frozen") return false;
    try {
      this.content.assertCurrent(userId, conversation.selection);
      return true;
    } catch (error) {
      if (
        !(error instanceof SelectionQaError) ||
        error.code !== "CONTENT_VERSION_CHANGED"
      )
        throw error;
      this.store.freeze(userId, conversation.id);
      return false;
    }
  }
  private newTurn(
    userId: number,
    conversationId: string,
    turnNumber: number,
    question: string,
    retryOfTurnId: string | null,
  ): Turn {
    const now = Date.now();
    return {
      id: randomUUID(),
      userId,
      conversationId,
      turnNumber,
      question,
      answer: "",
      status: "queued",
      errorCode: null,
      retryOfTurnId,
      deadline: now + QA_POLICY.deadlineMs,
      lastSequence: 0,
      phase: "queued",
      citations: [],
      createdAt: now,
      updatedAt: now,
    };
  }
}
