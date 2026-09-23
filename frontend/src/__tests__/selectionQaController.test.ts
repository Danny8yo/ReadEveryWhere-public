import { describe, it, expect, vi } from "vitest";
import {
  createQaController,
  createQaState,
} from "../features/selection-qa/domain/controller";
import { renderedAnswer } from "../features/selection-qa/domain/protocol";
import type {
  QaApi,
  Turn,
  Conversation,
  LoadedEpubIdentity,
} from "../features/selection-qa/model/selectionQa";
const identity: LoadedEpubIdentity = {
  fileChecksum: "sha256:" + "a".repeat(64),
  extractorVersion: "v5",
  normalizationVersion: "v2",
};
const selection = {
  scope: { bookId: 1, ...identity, sectionIndex: 0, href: "a.xhtml" },
  artifact: { bookId: 1, artifactId: "a", fileChecksum: identity.fileChecksum },
  source: { start: { path: [0], offset: 0 }, end: { path: [0], offset: 4 } },
  displayedQuote: "原选文字",
  canonicalQuote: "原选文字",
  start: 0,
  end: 4,
};
const conversation: Conversation = {
  id: "conversation",
  bookId: 1,
  selection,
  status: "active",
  frozenReason: null,
  firstQuestion: "问题",
  createdAt: 1,
  updatedAt: 1,
};
const turn = (n: number, status: Turn["status"] = "completed"): Turn => ({
  id: "turn-" + n,
  conversationId: "conversation",
  turnNumber: n,
  question: "问题",
  answer: "回答",
  status,
  phase: "answer",
  citations: [],
  lastSequence: 3,
  errorCode: null,
  deadline: 9999999,
});
function harness(loaded: LoadedEpubIdentity | null = identity) {
  const state = createQaState();
  const api: QaApi = {
    conversations: vi.fn(async () => ({
      items: [conversation],
      nextCursor: null,
    })),
    conversation: vi.fn(async () => conversation),
    turns: vi.fn(async () => ({ items: [turn(1)], nextCursor: null })),
    execute: vi.fn(async () => turn(1)),
    receipt: vi.fn(async () => null),
    stop: vi.fn(async () => turn(1, "cancelled")),
    delete: vi.fn(async () => {}),
    location: vi.fn(async () => ({
      scope: selection.scope,
      artifact: selection.artifact,
      cfi: "epubcfi(/6/2!/4/2,/1:0,/1:4)",
      quote: "原选文字",
      quoteHash: "hash",
      locator: {},
    })),
    annotations: vi.fn(async () => []),
    subscribe: vi.fn(() => () => {}),
  };
  const later = vi.fn(() => () => {});
  const controller = createQaController(state, 1, api, {
    identity: () => loaded,
    commandId: () => "command",
    navigate: async () => {},
    changed: async () => {},
    later,
    savePending: () => {},
    loadPending: () => null,
  });
  return { state, api, controller, later };
}
describe("selection QA recovery and public text", () => {
  it.each(["LOCATOR_INVALID", "LOCATOR_OUT_OF_RANGE", "TEXT_QUOTE_MISMATCH", "CONTENT_REVISION_MISMATCH", "BOOK_NOT_FOUND", "BOOK_FILE_MISSING", "UNSUPPORTED_FORMAT", "EXTRACTION_FAILED"])("clears a creation rejected with %s while preserving the question", async reason => {
    const h = harness();
    h.state.selection = { scope: selection.scope, cfi: "epubcfi(/6/2!/4/2:0)", displayedQuote: "原选文字" };
    h.state.question = "解释这段文字";
    h.api.execute = vi.fn(async () => { throw Object.assign(new Error("selection rejected"), { details: { reason } }); });
    await h.controller.send();
    expect(h.api.execute).toHaveBeenCalledTimes(1);
    expect(h.state.pending).toBeNull();
    expect(h.state.conversation).toBeNull();
    expect(h.state.question).toBe("解释这段文字");
    expect(h.state.error).toBeTruthy();
  });
  it("loads stable pages through turn 101 and subscribes to the actual active tail", async () => {
    const h = harness();
    h.api.turns = vi.fn(async (_id, cursor = 0) =>
      cursor === 0
        ? {
            items: Array.from({ length: 100 }, (_, i) => turn(i + 1)),
            nextCursor: 100,
          }
        : { items: [turn(101, "running")], nextCursor: null },
    );
    await h.controller.open();
    await h.controller.select("conversation");
    expect(h.state.turns).toHaveLength(101);
    expect(h.state.turnCursor).toBeNull();
    expect(h.api.subscribe).toHaveBeenLastCalledWith(
      "turn-101",
      3,
      expect.any(Object),
    );
    await h.controller.refresh();
    expect(h.state.turns).toHaveLength(101);
  });
  it("restores a snapshot on a sequence gap without duplicating the older answer", async () => {
    const h = harness();
    h.api.turns = vi.fn(async () => ({
      items: [turn(1, "running")],
      nextCursor: null,
    }));
    await h.controller.open();
    await h.controller.select("conversation");
    const handlers = vi.mocked(h.api.subscribe).mock.calls[0][2];
    handlers.event({
      schemaVersion: 1,
      turnId: "turn-1",
      sequence: 3,
      kind: "answer_delta",
      data: { text: "duplicate" },
    });
    expect(h.state.turns[0].answer).toBe("回答");
    handlers.event({
      schemaVersion: 1,
      turnId: "turn-1",
      sequence: 5,
      kind: "answer_delta",
      data: { text: "gap" },
    });
    expect(h.state.turns[0].answer).toBe("回答");
    expect(h.state.streamStatus).toBe("reconnecting");
    expect(h.later).toHaveBeenCalledTimes(1);
  });
  it("previews selected text crossing a rendered citation while rejecting unrelated text", async () => {
    const h = harness();
    const value = turn(1);
    value.answer = "前[[evidence:e1]]后";
    value.citations = [
      {
        evidenceId: "e1",
        quote: "原文",
        quoteHash: "hash",
        cfi: "epubcfi(/6/2)",
        sectionIndex: 0,
        href: "a.xhtml",
        start: 0,
        end: 2,
        displayedQuote: "原文",
      },
    ];
    h.api.turns = vi.fn(async () => ({ items: [value], nextCursor: null }));
    await h.controller.open();
    await h.controller.select("conversation");
    expect(renderedAnswer(value)).toBe("前[1]后");
    await h.controller.preview(value.id, "前[1]后");
    expect(h.state.preview?.text).toBe("前[1]后");
    h.state.preview = null;
    await h.controller.preview(value.id, "别的回答");
    expect(h.state.preview).toBeNull();
    expect(h.state.error).toContain("不属于");
  });
  it.each([null, { ...identity, fileChecksum: "sha256:" + "b".repeat(64) }])(
    "keeps history readable but rejects a follow-up with missing or stale loaded identity",
    async (loaded) => {
      const h = harness(loaded);
      await h.controller.open();
      await h.controller.select("conversation");
      h.state.question = "继续解释";
      await h.controller.send();
      expect(h.state.turns).toHaveLength(1);
      expect(h.api.execute).not.toHaveBeenCalled();
      expect(h.state.error).toMatch(/文件|版本/);
      expect(h.controller.unavailableReason()).toBeTruthy();
    },
  );
});
