import { Injectable } from "@nestjs/common";
import { SqliteService } from "../../../../../platform/persistence/sqlite/sqlite.service";
import type { SessionValidityPort } from "../../../public/session-validity.port";
@Injectable()
export class SessionValidityAdapter implements SessionValidityPort {
  constructor(private readonly sqlite: SqliteService) {}
  isActive(input: { sessionId: string; userId: number }): boolean {
    const now = Date.now();
    return Boolean(
      this.sqlite
        .getDatabase()
        .prepare(
          "SELECT 1 FROM auth_sessions WHERE id=? AND user_id=? AND expires_at>? AND absolute_expires_at>?",
        )
        .get(input.sessionId, input.userId, now, now),
    );
  }
}
