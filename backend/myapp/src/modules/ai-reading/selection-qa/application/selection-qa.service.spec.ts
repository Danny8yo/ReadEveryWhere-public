import { QA_POLICY } from "./selection-qa-runtime.port";
const admission = {
  snapshot: () => ({
    version: 1 as const,
    providerId: "test",
    modelId: "test",
    configUpdatedAt: null,
    tokenizerId: "test",
    contextWindowTokens: 64000,
    maxOutputTokens: 4096,
    policyVersion: QA_POLICY.version,
  }),
};
import { DatabaseSync } from "node:sqlite";
import { initializeSchema } from "../../../../platform/persistence/sqlite/schema-migrations";
import { seedUpgradeFixture } from "../../../../platform/persistence/sqlite/schema-upgrade.fixture";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import { SqliteSelectionQaRepository } from "../infrastructure/sqlite-selection-qa.repository";
import { SelectionQaService } from "./selection-qa.service";
import { SelectionQaError, SelectionSnapshot } from "./selection-qa.types";
const selection = {
  scope: {
    bookId: 1,
    fileChecksum: "checksum",
    extractorVersion: "v1",
    normalizationVersion: "v1",
    sectionIndex: 0,
    href: "chapter.xhtml",
  },
  artifact: { bookId: 1, artifactId: "artifact", fileChecksum: "checksum" },
  source: { start: { path: [0], offset: 0 }, end: { path: [0], offset: 4 } },
  displayedQuote: "text",
  canonicalQuote: "text",
  start: 0,
  end: 4,
} as SelectionSnapshot;
describe("selection QA persistent commands", () => {
  let db: DatabaseSync,
    service: SelectionQaService,
    store: SqliteSelectionQaRepository,
    current: boolean;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    initializeSchema(db);
    seedUpgradeFixture(db);
    store = new SqliteSelectionQaRepository({
      getDatabase: () => db,
    } as SqliteService);
    current = true;
    service = new SelectionQaService(
      store,
      {
        resolve: async () => selection,
        assertCurrent: () => {
          if (!current) throw new SelectionQaError("CONTENT_VERSION_CHANGED");
        },
      },
      {
        findReceipt: () => null,
        execute: async () => {
          throw new Error("unused");
        },
      },
      admission,
    );
  });
  afterEach(() => db.close());
  const input = {
    commandId: "create",
    bookId: 1,
    selection,
    question: "Explain",
  };
  async function create() {
    return (await service.create(1, input)) as {
      conversation: { id: string };
      turn: { id: string };
    };
  }
  it("atomically creates first turn and preserves receipt after deletion", async () => {
    const first = await create();
    expect(await service.create(1, input)).toEqual(first);
    service.stop(1, first.turn.id);
    service.delete(1, first.conversation.id);
    expect(await service.create(1, input)).toEqual(first);
    expect(
      db.prepare("SELECT * FROM selection_qa_conversations").all(),
    ).toEqual([]);
  });
  it("rejects invalid selection during creation without saving a conversation, turn or receipt", async () => {
    const rejecting = new SelectionQaService(store, {
      resolve: async () => { throw new SelectionQaError("INVALID_SELECTION"); },
      assertCurrent: () => {},
    }, { findReceipt: () => null, execute: async () => { throw new Error("unused"); } }, admission);
    await expect(rejecting.create(1, input)).rejects.toThrow("INVALID_SELECTION");
    expect(db.prepare("SELECT * FROM selection_qa_conversations").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM selection_qa_turns").all()).toEqual([]);
    expect(store.receipt(1, input.commandId, "unused")).toBeNull();
  });
  it("rejects changed payload and concurrent turns", async () => {
    const first = await create();
    await expect(
      service.create(1, { ...input, question: "changed" }),
    ).rejects.toThrow("COMMAND_PAYLOAD_MISMATCH");
    expect(() =>
      service.addTurn(1, first.conversation.id, {
        commandId: "next",
        question: "next",
      }),
    ).toThrow("ACTIVE_TURN_EXISTS");
  });
  it("stops idempotently and appends retry with durable receipt", async () => {
    const first = await create();
    const stopped = service.stop(1, first.turn.id);
    expect(service.stop(1, first.turn.id)).toEqual(stopped);
    const next = {
      commandId: "next",
      question: "retry",
      retryOfTurnId: first.turn.id,
    };
    const result = service.addTurn(1, first.conversation.id, next);
    expect(service.addTurn(1, first.conversation.id, next)).toEqual(result);
    expect(service.events(1, first.turn.id, 0)).toHaveLength(2);
  });
  it("commits freeze before rejecting continuation", async () => {
    const first = await create();
    current = false;
    expect(() =>
      service.addTurn(1, first.conversation.id, {
        commandId: "next",
        question: "next",
      }),
    ).toThrow("CONVERSATION_FROZEN");
    expect(store.conversation(1, first.conversation.id).status).toBe("frozen");
    expect(store.turn(1, first.turn.id).status).toBe("failed");
  });
  it("prevents cross-user lookup and active deletion", async () => {
    const first = await create();
    expect(() => service.get(2, first.conversation.id)).toThrow(
      "CONVERSATION_NOT_FOUND",
    );
    expect(() => service.delete(1, first.conversation.id)).toThrow(
      "ACTIVE_TURN_EXISTS",
    );
  });
  it("paginates stable creation order", async () => {
    for (let n = 0; n < 3; n++)
      await service.create(1, { ...input, commandId: String(n) });
    const page = service.list(1, 1, undefined, 2);
    expect(page.items).toHaveLength(2);
    const next = service.list(1, 1, page.nextCursor!, 2);
    expect(next.items).toHaveLength(1);
    expect(
      new Set([...page.items, ...next.items].map((row) => row.id)).size,
    ).toBe(3);
    expect(() => service.list(1, 1, "bad", 2)).toThrow("INVALID_CURSOR");
  });
  it("database rejects second active turn and cross-tenant child", async () => {
    const first = await create();
    const insert = db.prepare(
      "INSERT INTO selection_qa_turns(id,user_id,conversation_id,turn_number,question,status,deadline,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    );
    expect(() =>
      insert.run(
        "duplicate",
        1,
        first.conversation.id,
        2,
        "q",
        "queued",
        1,
        1,
        1,
      ),
    ).toThrow();
    expect(() =>
      insert.run(
        "foreign",
        2,
        first.conversation.id,
        2,
        "q",
        "completed",
        1,
        1,
        1,
      ),
    ).toThrow();
  });
  it("replays apply receipt before reading a deleted turn", async () => {
    const first = await create();
    service.stop(1, first.turn.id);
    service.delete(1, first.conversation.id);
    const receipt = {
      receipt: {
        commandId: "apply",
        annotation: { id: "saved", revision: 1, note: "answer" },
        readingStateVersion: 8,
        createdAt: 1,
      },
      currentAnnotation: null,
      replayed: true,
    };
    const replayService = new SelectionQaService(
      store,
      {
        resolve: async () => {
          throw new Error("must not resolve");
        },
        assertCurrent: () => {
          throw new Error("must not fence");
        },
      },
      {
        findReceipt: () => receipt,
        execute: async () => {
          throw new Error("must not append");
        },
      },
      admission,
    );
    expect(
      await replayService.apply(1, first.turn.id, {
        commandId: "apply",
        appendText: "answer",
        target: { kind: "append", annotationId: "saved", expectedRevision: 1 },
      }),
    ).toEqual(receipt);
  });

  it("requires a terminal persisted answer for a new apply command", async () => {
    const first = await create();
    const input = {
      commandId: "apply",
      appendText: "answer",
      target: {
        kind: "append" as const,
        annotationId: "saved",
        expectedRevision: 1,
      },
    };
    await expect(service.apply(1, first.turn.id, input)).rejects.toThrow(
      "TURN_NOT_APPLICABLE",
    );
    service.stop(1, first.turn.id);
    await expect(service.apply(1, first.turn.id, input)).rejects.toThrow(
      "TURN_NOT_APPLICABLE",
    );
  });
  it("accepts edited text from each terminal partial answer", async () => {
    const first = await create();
    const receipt = {
      receipt: {
        commandId: "apply",
        annotation: { id: "saved", revision: 1, note: "edited" },
        readingStateVersion: 8,
        createdAt: 1,
      },
      currentAnnotation: null,
      replayed: false,
    };
    const execute = jest.fn(async () => receipt);
    const applying = new SelectionQaService(
      store,
      { resolve: async () => selection, assertCurrent: () => {} },
      { findReceipt: () => null, execute },
      admission,
    );
    for (const status of ["completed", "cancelled", "failed", "timed_out"]) {
      db.prepare(
        "UPDATE selection_qa_turns SET status=?,answer=? WHERE id=?",
      ).run(status, "partial answer", first.turn.id);
      expect(
        await applying.apply(1, first.turn.id, {
          commandId: status,
          appendText: "user edited", acceptUnverified: true,
          target: {
            kind: "append",
            annotationId: "saved",
            expectedRevision: 1,
          },
        }),
      ).toEqual(receipt);
    }
    expect(execute).toHaveBeenCalledTimes(4);
  });
});
