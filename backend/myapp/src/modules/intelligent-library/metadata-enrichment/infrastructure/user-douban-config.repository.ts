import { Injectable } from "@nestjs/common";
import { CryptoService } from "../../../../platform/crypto/crypto.service";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import type { DoubanSettingsPort } from "../application/ports/douban-settings.port";

/**
 * 每个用户独立的豆瓣配置（一号一 Cookie）。
 * Cookie 属登录态凭据，加密存储（复用与 Z-Library 凭据一致的 AES-256-GCM）。
 *
 * 注意：豆瓣「请求间隔」是服务端对豆瓣的整体限速闸门，与用户无关，
 * 仍保持全局（部署者通过 .env 配置），不在此表。
 */
@Injectable()
export class UserDoubanConfigRepository implements DoubanSettingsPort {
  constructor(
    private readonly sqliteService: SqliteService,
    private readonly cryptoService: CryptoService,
  ) {}

  /** 返回该用户解密后的豆瓣 Cookie；未配置返回空串。 */
  getCookie(userId: number): string {
    const db = this.sqliteService.getDatabase();
    const row = db
      .prepare("SELECT cookie FROM user_douban_config WHERE user_id = ? LIMIT 1")
      .get(userId) as { cookie: string } | undefined;

    if (!row || !row.cookie) return "";
    return this.decryptIfNeeded(row.cookie);
  }

  /** 写入/更新该用户的豆瓣 Cookie（空串表示清除）。 */
  upsertCookie(userId: number, cookie: string): void {
    const db = this.sqliteService.getDatabase();
    const now = new Date().toISOString();
    const stored = cookie ? this.cryptoService.encrypt(cookie) : "";

    db.prepare(`
      INSERT INTO user_douban_config (user_id, cookie, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        cookie     = excluded.cookie,
        updated_at = excluded.updated_at
    `).run(userId, stored, now, now);
  }

  private decryptIfNeeded(value: string): string {
    // 加密格式: "iv:authTag:ciphertext"（三段 hex）。格式明确后解密失败表示密文损坏，不能伪装成明文。
    const parts = value.split(":");
    const looksEncrypted = parts.length === 3 && parts[0].length === 24 && parts[1].length === 32
      && /^[0-9a-f]+$/i.test(parts[0]) && /^[0-9a-f]+$/i.test(parts[1]) && /^[0-9a-f]*$/i.test(parts[2]);
    if (looksEncrypted) return this.cryptoService.decrypt(value);
    if (parts.length === 3 && parts.every((part) => /^[0-9a-f]*$/i.test(part))) {
      throw new Error("Stored Douban cookie has an invalid encrypted format");
    }
    // 历史明文 Cookie 不含上述严格的三段十六进制格式，读取时继续兼容。
    return value;
  }
}
