import { Injectable } from "@nestjs/common";
import type {
  SessionRecord,
  SessionRepositoryPort,
} from "../../../application/ports/session-repository.port";
import { SqliteService } from "../../../../../platform/persistence/sqlite/sqlite.service";
@Injectable()
export class SessionsRepository implements SessionRepositoryPort {
  constructor(private readonly sqlite: SqliteService) {}
  create(
    id: string,
    userId: number,
    hash: string,
    now: number,
    expires: number,
    absolute: number,
  ) {
    const db = this.sqlite.getDatabase();
    db.prepare(
      "DELETE FROM auth_sessions WHERE expires_at <= ? OR absolute_expires_at <= ?",
    ).run(now, now);
    db.prepare(
      "INSERT INTO auth_sessions(id,user_id,token_hash,created_at,renewed_at,expires_at,absolute_expires_at) VALUES(?,?,?,?,?,?,?)",
    ).run(id, userId, hash, now, now, expires, absolute);
  }
  find(hash: string, now: number): SessionRecord | null {
    const row = this.sqlite
      .getDatabase()
      .prepare(
        "SELECT s.id,s.user_id AS userId,u.email,s.expires_at AS expiresAt,s.absolute_expires_at AS absoluteExpiresAt,s.renewed_at AS renewedAt FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>? AND absolute_expires_at>?",
      )
      .get(hash, now, now);
    return row ? (row as unknown as SessionRecord) : null;
  }
  renew(id: string, now: number, expires: number) {
    this.sqlite
      .getDatabase()
      .prepare(
        "UPDATE auth_sessions SET renewed_at=?,expires_at=? WHERE id=? AND expires_at>? AND absolute_expires_at>? AND renewed_at<?",
      )
      .run(now, expires, id, now, now, now);
  }
  revoke(id: string) {
    this.sqlite
      .getDatabase()
      .prepare("DELETE FROM auth_sessions WHERE id=?")
      .run(id);
  }
  revokeUser(id: number) {
    this.sqlite
      .getDatabase()
      .prepare("DELETE FROM auth_sessions WHERE user_id=?")
      .run(id);
  }
}
