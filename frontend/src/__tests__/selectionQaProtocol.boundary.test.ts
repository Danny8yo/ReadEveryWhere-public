import { describe, expect, it } from "vitest";
import {
  answerParts,
  plainAnswer,
  reduceEvent,
  selectionRequest,
  verifyLoadedLocation,
} from "../features/selection-qa/domain/protocol";
import type {
  LoadedEpubIdentity,
  Turn,
  ValidatedLocation,
} from "../features/selection-qa/model/selectionQa";
const identity: LoadedEpubIdentity = {
  fileChecksum: `sha256:${"a".repeat(64)}`,
  extractorVersion: "extract-v1",
  normalizationVersion: "norm-v1",
};
const turn = (): Turn => ({
  id: "turn",
  conversationId: "conv",
  turnNumber: 1,
  question: "why",
  answer: "",
  status: "running",
  phase: "answering",
  citations: [],
  errorCode: null,
  lastSequence: 3,
  deadline: 999,
});
const location = (): ValidatedLocation => ({
  scope: { bookId: 1, ...identity, sectionIndex: 0, href: "chapter.xhtml" },
  artifact: {
    bookId: 1,
    artifactId: "artifact",
    fileChecksum: identity.fileChecksum,
  },
  cfi: "epubcfi(/6/2!/4/2:0)",
  quote: "text",
  quoteHash: "hash",
  locator: {},
});
describe("selection QA independent protocol boundaries", () => {
  it.each([
    "fileChecksum",
    "extractorVersion",
    "normalizationVersion",
  ] as const)("rejects changed loaded %s before navigation", (key) => {
    const changed = { ...identity, [key]: "changed" };
    expect(() => verifyLoadedLocation(1, changed, location())).toThrow();
  });
  it("rejects foreign book and artifact checksum even when scope looks current", () => {
    expect(() => verifyLoadedLocation(2, identity, location())).toThrow();
    const value = location();
    value.artifact.fileChecksum = "changed";
    expect(() => verifyLoadedLocation(1, identity, value)).toThrow();
  });
  it("preserves raw quote whitespace and projects authoritative book id", () => {
    const contaminated = { ...identity, bookId: 999 } as LoadedEpubIdentity;
    const request = selectionRequest(1, contaminated, {
      sectionIndex: 0,
      href: "chapter.xhtml",
      cfi: "epubcfi(/6/2!/4/2:0)",
      displayedQuote: "  raw\nquote  ",
    });
    expect(request.scope.bookId).toBe(1);
    expect(request.displayedQuote).toBe("  raw\nquote  ");
  });
  it("rejects wrong-turn events without mutating the current draft", () => {
    const value = turn();
    const before = structuredClone(value);
    expect(() =>
      reduceEvent(value, {
        schemaVersion: 1,
        turnId: "other",
        sequence: 4,
        kind: "answer_delta",
        data: { text: "injected" },
      }),
    ).toThrow();
    expect(value).toEqual(before);
  });
  it("does not apply an event gap or duplicate delta", () => {
    const value = turn();
    expect(
      reduceEvent(value, {
        schemaVersion: 1,
        turnId: value.id,
        sequence: 5,
        kind: "answer_delta",
        data: { text: "gap" },
      }),
    ).toBe("gap");
    expect(value.answer).toBe("");
    expect(
      reduceEvent(value, {
        schemaVersion: 1,
        turnId: value.id,
        sequence: 3,
        kind: "answer_delta",
        data: { text: "duplicate" },
      }),
    ).toBe("duplicate");
    expect(value.answer).toBe("");
  });
  it.each(["answer_delta", "status"] as const)(
    "rejects a new %s after terminal",
    (kind) => {
      const value = turn();
      value.status = "completed";
      value.answer = "complete";
      const before = structuredClone(value);
      expect(() =>
        reduceEvent(value, {
          schemaVersion: 1,
          turnId: value.id,
          sequence: 4,
          kind,
          data: kind === "status" ? { status: "running" } : { text: "late" },
        }),
      ).toThrow();
      expect(value).toEqual(before);
    },
  );
  it("never turns an unknown answer marker into a clickable citation", () => {
    const value = turn();
    value.answer = "Text [[evidence:forged]]";
    expect(answerParts(value).every((part) => part.kind === "text")).toBe(true);
    expect(plainAnswer(value)).toContain("[引用未验证]");
  });
  it("citation-only events change neither answer nor terminal status", () => {
    const value = turn();
    value.answer = "partial";
    reduceEvent(value, {
      schemaVersion: 1,
      turnId: value.id,
      sequence: 4,
      kind: "citation",
      data: { evidence: { evidenceId: "known", quote: "verified" } },
    });
    expect(value.answer).toBe("partial");
    expect(value.status).toBe("running");
    expect(value.citations).toHaveLength(1);
  });
});

import { vi } from "vitest";
import {
  createQaController,
  createQaState,
} from "../features/selection-qa/domain/controller";
import type {
  QaApi,
  Conversation,
  PendingCommand,
} from "../features/selection-qa/model/selectionQa";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
function setupController() {
  const state = createQaState();
  const conversation = {
    id: "conv",
    bookId: 1,
    status: "active",
    firstQuestion: "why",
    frozenReason: null,
    createdAt: 1,
    updatedAt: 1,
  } as Conversation;
  const api = {
    conversations: vi.fn(async () => ({ items: [], nextCursor: null })),
    conversation: vi.fn(async () => conversation),
    turns: vi.fn(async () => ({ items: [], nextCursor: null })),
    location: vi.fn(async () => location()),
    annotations: vi.fn(async () => []),
    execute: vi.fn(),
    receipt: vi.fn(async () => null),
    subscribe: vi.fn(() => () => {}),
    stop: vi.fn(),
    delete: vi.fn(),
  } as unknown as QaApi;
  let pending: PendingCommand | null = null;
  const changed = vi.fn(async () => {});
  let commandNumber = 0;
  const controller = createQaController(state, 1, api, {
    identity: () => identity,
    commandId: () => `cmd-${++commandNumber}`,
    navigate: vi.fn(async () => {}),
    changed,
    later: () => () => {},
    savePending: (value) => (pending = value),
    loadPending: () => pending,
  });
  return { state, api, controller, conversation, changed };
}
describe("selection QA independent asynchronous boundaries", () => {
  it("does not reopen a late annotation preview after close", async () => {
    const { state, api, controller, conversation } = setupController();
    state.open = true;
    state.conversation = conversation;
    state.turns = [{ ...turn(), status: "completed", answer: "complete" }];
    const waiting = deferred<ValidatedLocation>();
    api.location = () => waiting.promise;
    const operation = controller.preview("turn");
    controller.close();
    waiting.resolve(location());
    await operation;
    expect(state.preview).toBeNull();
    expect(state.open).toBe(false);
  });
  it("does not switch a newer selection to a late create reply", async () => {
    const { state, api, controller, conversation } = setupController();
    state.open = true;
    state.pending = {
      kind: "create",
      body: {
        commandId: "old",
        bookId: 1,
        selection: selectionRequest(1, identity, {
          sectionIndex: 0,
          href: "chapter.xhtml",
          cfi: "epubcfi(/6/2!/4/2:0)",
          displayedQuote: "A",
        }),
        question: "A?",
      },
    };
    const waiting = deferred<{ conversation: Conversation; turn: Turn }>();
    api.execute = () => waiting.promise;
    const operation = controller.retryPending();
    const next = selectionRequest(1, identity, {
      sectionIndex: 0,
      href: "chapter.xhtml",
      cfi: "epubcfi(/6/2!/4/2:1)",
      displayedQuote: "B",
    });
    await controller.open(next);
    waiting.resolve({ conversation, turn: turn() });
    await operation;
    expect(state.selection).toEqual(next);
    expect(state.conversation).toBeNull();
  });
  it("confirms a historical apply receipt without recreating a deleted current annotation", async () => {
    const { state, api, controller, changed } = setupController();
    state.open = true;
    state.pending = {
      kind: "apply",
      turnId: "deleted-turn",
      body: {
        commandId: "done",
        appendText: "text",
        target: {
          kind: "append",
          annotationId: "deleted-note",
          expectedRevision: 1,
        },
      },
    };
    api.receipt = vi.fn(async () => ({
      receipt: {
        commandId: "done",
        annotation: { id: "deleted-note", revision: 2, note: "text" } as never,
        readingStateVersion: 2,
        createdAt: 1,
      },
      currentAnnotation: null,
      replayed: true,
    }));
    await controller.retryPending();
    expect(api.execute).not.toHaveBeenCalled();
    expect(state.pending).toBeNull();
    expect(state.notice).toContain("已删除");
    expect(changed).toHaveBeenCalledOnce();
  });
});

describe("selection QA pending ownership during awaits", () => {
  it("submits selection and question together once; a late response cannot replace selection B", async () => {
    const { state, api, controller } = setupController();
    const anchor = (text: string) =>
      selectionRequest(1, identity, {
        sectionIndex: 0,
        href: "chapter.xhtml",
        cfi: "epubcfi(/6/2!/4/2:0)",
        displayedQuote: text,
      });
    state.open = true;
    state.selection = anchor("A");
    state.question = "question A";
    const waiting = deferred<Awaited<ReturnType<QaApi["execute"]>>>();
    api.execute = vi.fn(() => waiting.promise);
    const operation = controller.send();
    await controller.open(anchor("B"));
    waiting.resolve({ conversation: { id: "conv-A" }, turn: turn() } as Awaited<ReturnType<QaApi["execute"]>>);
    await operation;
    expect(api.execute).toHaveBeenCalledTimes(1);
    expect(api.execute).toHaveBeenCalledWith(expect.objectContaining({ kind: "create", body: expect.objectContaining({ question: "question A", selection: expect.objectContaining({ displayedQuote: "A" }) }) }));
    expect(state.conversation).toBeNull();
    expect(state.pending).toBeNull();
    expect(state.selection?.displayedQuote).toBe("B");
  });
  it("does not append an older conversation page into a new selection", async () => {
    const { state, api, controller, conversation } = setupController();
    state.open = true;
    state.conversation = conversation;
    state.turnCursor = 1;
    const waiting = deferred<{ items: Turn[]; nextCursor: number | null }>();
    api.turns = () => waiting.promise;
    const operation = controller.moreTurns();
    await controller.open(
      selectionRequest(1, identity, {
        sectionIndex: 0,
        href: "chapter.xhtml",
        cfi: "epubcfi(/6/2!/4/2:0)",
        displayedQuote: "B",
      }),
    );
    waiting.resolve({ items: [turn()], nextCursor: null });
    await operation;
    expect(state.turns).toEqual([]);
    expect(state.conversation).toBeNull();
  });
});

describe("selection QA current selection errors", () => {
  it("shows a failure from the current select operation", async () => {
    const { state, api, controller } = setupController();
    state.open = true;
    api.conversation = async () => {
      throw new Error("conversation unavailable");
    };
    await controller.select("missing");
    expect(state.error).toContain("conversation unavailable");
  });
});

describe("selection QA CAS and unknown result boundaries", () => {
  it("keeps an unknown network result pending with the identical command", async () => {
    const { state, api, controller } = setupController();
    const command: PendingCommand = {
      kind: "apply",
      turnId: "turn",
      body: {
        commandId: "same",
        appendText: "draft",
        target: { kind: "append", annotationId: "note", expectedRevision: 1 },
      },
    };
    state.open = true;
    state.pending = command;
    api.execute = vi.fn(async () => {
      throw new Error("network disconnected");
    });
    await controller.retryPending();
    expect(state.pending).toEqual(command);
    await controller.retryPending();
    expect(api.execute).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.execute).mock.calls[0][0]).toEqual(
      vi.mocked(api.execute).mock.calls[1][0],
    );
  });
  it("preserves edited text and requires explicit CAS reconfirmation", async () => {
    const { state, api, controller } = setupController();
    state.open = true;
    state.preview = {
      turnId: "turn",
      text: "edited answer",
      targetId: "note",
      annotations: [{ id: "note", revision: 1 } as never],
      originalCfi: "epubcfi(/6/2!/4/2:0)",
      conflict: false,
    };
    api.execute = vi.fn(async () => {
      throw {
        code: 40003,
        message: "conflict",
        details: { reason: "ANNOTATION_CONFLICT" },
      };
    });
    api.annotations = vi.fn(async () => [
      { id: "note", revision: 2, note: "latest" } as never,
    ]);
    await controller.apply();
    expect(state.pending).toBeNull();
    expect(state.preview?.text).toBe("edited answer");
    expect(state.preview?.conflict).toBe(true);
    expect(state.preview?.annotations[0].revision).toBe(2);
    await controller.apply();
    expect(api.execute).toHaveBeenCalledOnce();
    controller.reconfirm();
    await controller.apply();
    expect(api.execute).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.execute).mock.calls[0][0].body.commandId).not.toBe(
      vi.mocked(api.execute).mock.calls[1][0].body.commandId,
    );
    expect(vi.mocked(api.execute).mock.calls[1][0].body).toMatchObject({
      target: { expectedRevision: 2 },
    });
  });
});

import {
  encodePending,
  decodePending,
} from "../features/selection-qa/domain/pending";
describe("selection QA pending persisted scope", () => {
  const pending: PendingCommand = {
    kind: "apply",
    turnId: "turn",
    body: {
      commandId: "unknown",
      appendText: " unchanged draft ",
      target: { kind: "append", annotationId: "note", expectedRevision: 3 },
    },
  };
  it("round-trips the exact payload for unknown-outcome replay", () => {
    expect(decodePending(encodePending(pending, 7, 9), 7, 9)).toEqual(pending);
  });
  it.each([
    [8, 9],
    [7, 10],
  ])(
    "rejects a receipt command moved across user/book storage scope",
    (user, book) => {
      expect(() =>
        decodePending(encodePending(pending, 7, 9), user, book),
      ).toThrow();
    },
  );
  it("rejects the old unscoped bare command and extra payload keys", () => {
    expect(() => decodePending(JSON.stringify(pending), 7, 9)).toThrow();
    const raw = JSON.parse(encodePending(pending, 7, 9));
    raw.command.body.target.bookHash = "injected";
    expect(() => decodePending(JSON.stringify(raw), 7, 9)).toThrow();
  });
  it("rejects a create command whose inner book differs from its envelope", () => {
    const selection = selectionRequest(1, identity, {
      sectionIndex: 0,
      href: "chapter.xhtml",
      cfi: "epubcfi(/6/2!/4/2:0)",
      displayedQuote: "text",
    });
    const raw = encodePending(
      {
        kind: "create",
        body: { commandId: "id", bookId: 1, selection, question: "why" },
      },
      7,
      9,
    );
    expect(() => decodePending(raw, 7, 9)).toThrow();
  });
});
