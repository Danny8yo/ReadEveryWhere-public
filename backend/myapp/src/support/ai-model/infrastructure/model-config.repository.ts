import { CryptoService } from "../../../platform/crypto/crypto.service";
import { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import {
  type DefaultModelConfig,
  type ModelConfigPort,
  type ModelCredential,
  type PublicModelConfig,
} from "../application/ports/model-config.port";

export type {
  ModelCredential,
  PublicModelConfig,
} from "../application/ports/model-config.port";

interface ModelConfigRow {
  provider: string;
  display_name: string;
  model_id: string;
  encrypted_api_key: string | null;
  updated_at: string;
}

export class ModelConfigRepository implements ModelConfigPort {
  constructor(
    private readonly sqliteService: SqliteService,
    private readonly cryptoService: CryptoService,
    private readonly defaults: Readonly<DefaultModelConfig>,
    private readonly supportedProviders: ReadonlySet<string>,
  ) {}

  getPublic(userId: number): PublicModelConfig {
    const row = this.findRow(userId);
    if (!row) return this.defaultPublic();
    return {
      provider: this.supportedProvider(row.provider),
      displayName: row.display_name,
      modelId: row.model_id,
      hasApiKey: Boolean(row.encrypted_api_key),
      updatedAt: row.updated_at,
    };
  }

  getCredential(userId: number): ModelCredential | null {
    const row = this.findRow(userId);
    if (!row?.encrypted_api_key) return null;
    return {
      provider: this.supportedProvider(row.provider),
      modelId: row.model_id,
      apiKey: this.cryptoService.decrypt(row.encrypted_api_key),
    };
  }

  save(userId: number, input: { apiKey?: string; modelId?: string }): PublicModelConfig {
    const existing = this.findRow(userId);
    const apiKey = input.apiKey?.trim();
    const modelId = input.modelId?.trim() || existing?.model_id || this.defaults.modelId;
    const encryptedApiKey = apiKey
      ? this.cryptoService.encrypt(apiKey)
      : existing?.encrypted_api_key ?? null;
    const now = new Date().toISOString();

    this.sqliteService.getDatabase().prepare(`
      INSERT INTO ai_model_configs (
        user_id, provider, display_name, model_id, encrypted_api_key, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        provider = excluded.provider,
        display_name = excluded.display_name,
        model_id = excluded.model_id,
        encrypted_api_key = excluded.encrypted_api_key,
        updated_at = excluded.updated_at
    `).run(
      userId,
      this.defaults.provider,
      this.defaults.displayName,
      modelId,
      encryptedApiKey,
      now,
    );

    return this.getPublic(userId);
  }

  remove(userId: number): boolean {
    const result = this.sqliteService.getDatabase()
      .prepare("DELETE FROM ai_model_configs WHERE user_id = ?")
      .run(userId);
    return result.changes > 0;
  }

  private findRow(userId: number): ModelConfigRow | null {
    const row = this.sqliteService.getDatabase().prepare(`
      SELECT provider, display_name, model_id, encrypted_api_key, updated_at
      FROM ai_model_configs
      WHERE user_id = ?
    `).get(userId) as unknown as ModelConfigRow | undefined;
    return row ?? null;
  }

  private defaultPublic(): PublicModelConfig {
    return {
      provider: this.defaults.provider,
      displayName: this.defaults.displayName,
      modelId: this.defaults.modelId,
      hasApiKey: false,
      updatedAt: null,
    };
  }

  private supportedProvider(value: string): string {
    if (!this.supportedProviders.has(value)) {
      throw new Error(`MODEL_PROVIDER_UNSUPPORTED:${value}`);
    }
    return value;
  }
}
