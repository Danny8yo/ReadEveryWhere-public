import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CryptoService } from "../../../platform/crypto/crypto.service";
import { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import { DEEPSEEK_DEFAULT_MODEL_CONFIG } from "../../../integrations/deepseek/deepseek-model-profile.contribution";
import { ModelConfigRepository } from "./model-config.repository";

describe("ModelConfigRepository", () => {
  let directory: string;
  let sqlite: SqliteService;
  let repository: ModelConfigRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "rew-ai-model-config-"));
    process.env.SQLITE_PATH = join(directory, "test.sqlite");
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
    sqlite = new SqliteService();
    sqlite.onModuleInit();
    repository = new ModelConfigRepository(
      sqlite,
      new CryptoService(),
      DEEPSEEK_DEFAULT_MODEL_CONFIG,
      new Set(["deepseek"]),
    );
  });

  afterEach(() => {
    sqlite.onApplicationShutdown();
    rmSync(directory, { recursive: true, force: true });
    delete process.env.SQLITE_PATH;
    delete process.env.ENCRYPTION_KEY;
  });

  it("encrypts each user's API key and never exposes it in the public view", () => {
    thisUser(sqlite, 1, "reader@example.com");

    const saved = repository.save(1, { apiKey: "sk-deepseek-private" });

    expect(saved).toMatchObject({
      provider: "deepseek",
      displayName: "DeepSeek-V4-flash",
      modelId: "deepseek-v4-flash",
      hasApiKey: true,
    });
    expect(JSON.stringify(saved)).not.toContain("sk-deepseek-private");
    expect(repository.getCredential(1)?.apiKey).toBe("sk-deepseek-private");
    expect(readFileSync(process.env.SQLITE_PATH!, "utf8").toString()).not.toContain("sk-deepseek-private");
  });

  it("isolates credentials by user and preserves the existing key when only modelId is updated", () => {
    thisUser(sqlite, 1, "one@example.com");
    thisUser(sqlite, 2, "two@example.com");
    repository.save(1, { apiKey: "key-one" });
    repository.save(2, { apiKey: "key-two" });

    repository.save(1, { modelId: "deepseek-v4-flash" });

    expect(repository.getCredential(1)?.apiKey).toBe("key-one");
    expect(repository.getCredential(2)?.apiKey).toBe("key-two");
    expect(repository.remove(1)).toBe(true);
    expect(repository.getCredential(1)).toBeNull();
    expect(repository.getPublic(2).hasApiKey).toBe(true);
  });

  it("reads and validates the persisted provider instead of hard-coding it", () => {
    thisUser(sqlite, 1, "reader@example.com");
    repository.save(1, { apiKey: "key-one" });
    sqlite.getDatabase().prepare("UPDATE ai_model_configs SET provider='unknown' WHERE user_id=1").run();

    expect(() => repository.getPublic(1)).toThrow("MODEL_PROVIDER_UNSUPPORTED:unknown");
    expect(() => repository.getCredential(1)).toThrow("MODEL_PROVIDER_UNSUPPORTED:unknown");
  });
});

function thisUser(sqlite: SqliteService, id: number, email: string): void {
  const now = new Date().toISOString();
  sqlite.getDatabase().prepare(`
    INSERT INTO users (id, email, password_hash, created_at, updated_at)
    VALUES (?, ?, 'hash', ?, ?)
  `).run(id, email, now, now);
}
