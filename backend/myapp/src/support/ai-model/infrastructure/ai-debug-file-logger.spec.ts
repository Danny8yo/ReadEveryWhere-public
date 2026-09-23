import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AiDebugFileLogger } from "./ai-debug-file-logger";

describe("AiDebugFileLogger", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "rew-ai-debug-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("writes private JSONL records, preserves model-visible content and redacts credentials", () => {
    const logger = new AiDebugFileLogger({
      enabled: true,
      directory,
      maxFileBytes: 1024 * 1024,
      retentionDays: 7,
      now: () => new Date("2026-08-15T08:00:00.000Z"),
    });

    logger.write({
      event: "llm.request",
      trace: { component: "ai-reading", taskId: "task-1", modelCallId: "model-1" },
      data: {
        apiKey: "secret-key",
        authorization: "Bearer secret-key",
        token: "plain-token-value",
        messages: [{ role: "tool", content: "真实模型可见正文" }],
      },
      secrets: ["secret-key"],
    });

    const files = readdirSync(directory).filter((name) => name.endsWith(".jsonl"));
    expect(files).toHaveLength(1);
    const filePath = join(directory, files[0]);
    const stored = readFileSync(filePath, "utf8");
    expect(stored).toContain("真实模型可见正文");
    expect(stored).not.toContain("secret-key");
    expect(stored).not.toContain("plain-token-value");
    expect(stored).toContain("[REDACTED]");
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
  });

  it("rotates across multiple JSONL files when the current file reaches the size limit", () => {
    const logger = new AiDebugFileLogger({
      enabled: true,
      directory,
      maxFileBytes: 260,
      retentionDays: 7,
      now: () => new Date("2026-08-15T08:00:00.000Z"),
    });

    for (let index = 0; index < 4; index += 1) {
      logger.write({
        event: "tool.result",
        data: { index, text: "x".repeat(120) },
      });
    }

    const files = readdirSync(directory)
      .filter((name) => name.endsWith(".jsonl"))
      .sort();
    expect(files).toEqual([
      "ai-debug-2026-08-15.1.jsonl",
      "ai-debug-2026-08-15.2.jsonl",
      "ai-debug-2026-08-15.3.jsonl",
      "ai-debug-2026-08-15.jsonl",
    ]);
    expect(files.map((name) => readFileSync(join(directory, name), "utf8")).join(""))
      .toContain('"index":3');
  });

  it("removes expired debug logs while preserving unrelated files", () => {
    const expiredLog = join(directory, "ai-debug-2026-08-01.jsonl");
    const unrelatedFile = join(directory, "notes.jsonl");
    writeFileSync(expiredLog, "expired\n", { mode: 0o600 });
    writeFileSync(unrelatedFile, "keep\n", { mode: 0o600 });
    const expiredAt = new Date("2026-08-01T00:00:00.000Z");
    utimesSync(expiredLog, expiredAt, expiredAt);
    utimesSync(unrelatedFile, expiredAt, expiredAt);

    const logger = new AiDebugFileLogger({
      enabled: true,
      directory,
      retentionDays: 7,
      now: () => new Date("2026-08-15T08:00:00.000Z"),
    });
    logger.write({ event: "llm.request", data: { messages: [] } });

    expect(existsSync(expiredLog)).toBe(false);
    expect(existsSync(unrelatedFile)).toBe(true);
    expect(existsSync(join(directory, "ai-debug-2026-08-15.jsonl"))).toBe(true);
  });

  it("does not create files while disabled", () => {
    const logger = new AiDebugFileLogger({ enabled: false, directory });
    logger.write({ event: "llm.request", data: { messages: [] } });
    expect(readdirSync(directory)).toEqual([]);
  });

  it("does not change task behavior when the target path cannot be written", () => {
    const fileInsteadOfDirectory = join(directory, "not-a-directory");
    writeFileSync(fileInsteadOfDirectory, "occupied", { mode: 0o600 });
    const logger = new AiDebugFileLogger({
      enabled: true,
      directory: fileInsteadOfDirectory,
    });

    expect(() => logger.write({ event: "tool.result", data: { completed: true } }))
      .not.toThrow();
  });
});
