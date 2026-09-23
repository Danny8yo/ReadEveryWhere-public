import { Injectable } from "@nestjs/common";
import { CryptoService } from "../../../../platform/crypto/crypto.service";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import {
  UserZlibraryConfig,
  UserZlibraryConfigRow,
} from "../domain/user-zlibrary-config.types";
import type {
  SourceSettingsStorePort,
  UpsertSourceSettingsInput,
} from "../application/ports/source-settings-store.port";

@Injectable()
export class UserZlibraryConfigRepository implements SourceSettingsStorePort {
  constructor(
    private readonly sqliteService: SqliteService,
    private readonly cryptoService: CryptoService,
  ) {}

  findByUserId(userId: number): UserZlibraryConfig | null {
    const db = this.sqliteService.getDatabase();
    const row = db
      .prepare("SELECT * FROM user_zlibrary_config WHERE user_id = ? LIMIT 1")
      .get(userId) as UserZlibraryConfigRow | undefined;

    if (!row) return null;

    const config = this.mapRow(row);

    // 解密凭据；格式或密钥错误必须暴露。
    config.remixUserid = this.decryptIfNeeded(config.remixUserid);
    config.remixUserkey = this.decryptIfNeeded(config.remixUserkey);

    // 跨天虚拟清零：如果 updated_at 不是今天，downloadsToday 归零
    if (config.updatedAt) {
      const updatedDate = config.updatedAt.slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      if (updatedDate !== today) {
        config.downloadsToday = 0;
      }
    }

    return config;
  }

  upsert(userId: number, input: UpsertSourceSettingsInput): UserZlibraryConfig {
    const db = this.sqliteService.getDatabase();
    const now = new Date().toISOString();

    // 加密凭据
    const encryptedUserid = this.cryptoService.encrypt(input.remixUserid);
    const encryptedUserkey = this.cryptoService.encrypt(input.remixUserkey);

    db.prepare(`
      INSERT INTO user_zlibrary_config
        (user_id, base_url, remix_userid, remix_userkey,
         downloads_today, downloads_limit, is_premium,
         is_active, last_login_at, login_status, login_error,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        base_url        = excluded.base_url,
        remix_userid    = excluded.remix_userid,
        remix_userkey   = excluded.remix_userkey,
        downloads_today = excluded.downloads_today,
        downloads_limit = excluded.downloads_limit,
        is_premium      = excluded.is_premium,
        is_active       = 1,
        last_login_at   = excluded.last_login_at,
        login_status    = excluded.login_status,
        login_error     = excluded.login_error,
        updated_at      = excluded.updated_at
    `).run(
      userId,
      input.baseUrl,
      encryptedUserid,
      encryptedUserkey,
      input.downloadsToday,
      input.downloadsLimit,
      input.isPremium ? 1 : 0,
      input.lastLoginAt,
      input.loginStatus,
      input.loginError ?? null,
      now,
      now,
    );

    const saved = this.findByUserId(userId);
    if (!saved) throw new Error("Failed to load upserted user_zlibrary_config");
    return saved;
  }

  /**
   * 仅更新某用户的上游 base_url（一号一配置）。
   * - 已存在记录：只替换 base_url，保留登录态（remix cookie / login_status 不动）。
   * - 不存在记录：创建一条仅含 base_url 的「待登录」占位记录（凭据留空、未激活）。
   */
  updateBaseUrl(userId: number, baseUrl: string): void {
    const db = this.sqliteService.getDatabase();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_zlibrary_config
        (user_id, base_url, remix_userid, remix_userkey,
         is_active, login_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, 'pending', ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        base_url   = excluded.base_url,
        updated_at = excluded.updated_at
    `).run(
      userId,
      baseUrl,
      this.cryptoService.encrypt(""),
      this.cryptoService.encrypt(""),
      now,
      now,
    );
  }

  markLoginFailed(userId: number, errorMessage: string): void {
    const db = this.sqliteService.getDatabase();
    db.prepare(`
      UPDATE user_zlibrary_config
      SET login_status = 'failed',
          login_error = ?,
          is_active = 0,
          updated_at = ?
      WHERE user_id = ?
    `).run(errorMessage, new Date().toISOString(), userId);
  }

  incrementDownloadsToday(userId: number): void {
    const db = this.sqliteService.getDatabase();
    db.prepare(`
      UPDATE user_zlibrary_config
      SET downloads_today = downloads_today + 1,
          updated_at = ?
      WHERE user_id = ?
    `).run(new Date().toISOString(), userId);
  }

  deleteByUserId(userId: number): boolean {
    const db = this.sqliteService.getDatabase();
    const result = db.prepare("DELETE FROM user_zlibrary_config WHERE user_id = ?").run(userId);
    return result.changes > 0;
  }

  private mapRow(row: UserZlibraryConfigRow): UserZlibraryConfig {
    return {
      id: row.id,
      userId: row.user_id,
      baseUrl: row.base_url,
      remixUserid: row.remix_userid,
      remixUserkey: row.remix_userkey,
      downloadsToday: row.downloads_today,
      downloadsLimit: row.downloads_limit,
      isPremium: row.is_premium === 1,
      isActive: row.is_active === 1,
      lastLoginAt: row.last_login_at,
      loginStatus: row.login_status as UserZlibraryConfig["loginStatus"],
      loginError: row.login_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private decryptIfNeeded(value: string): string {
    // 凭据列始终保存为 AES-256-GCM 格式；格式或密钥错误必须暴露。
    return this.cryptoService.decrypt(value);
  }
}
