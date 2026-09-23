import { Injectable } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AiAccessTokenRepositoryPort } from "../../../application/ports/ai-access-token-repository.port";
import { SqliteService } from "../../../../../platform/persistence/sqlite/sqlite.service";
import {
  AI_ACCESS_TOKEN_PREFIX,
  AiAccessScope,
  AiAccessTokenPrincipal,
  AiAccessTokenSummary,
  CreatedAiAccessToken,
} from "../../../domain/ai-access-token.types";

interface AiAccessTokenRow {
  id: string;
  user_id: number;
  email?: string;
  name: string;
  token_hash: string;
  scopes_json: string;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
}

@Injectable()
export class AiAccessTokenRepository implements AiAccessTokenRepositoryPort {
  constructor(private readonly sqliteService: SqliteService) {}

  create(
    userId: number,
    name: string,
    scopes: AiAccessScope[],
    expiresAt: Date,
  ): CreatedAiAccessToken {
    const token = AI_ACCESS_TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.sqliteService.getDatabase().prepare(`
      INSERT INTO ai_access_tokens (
        id, user_id, name, token_hash, scopes_json, expires_at, created_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      id,
      userId,
      name,
      this.hash(token),
      JSON.stringify(scopes),
      expiresAt.toISOString(),
      createdAt,
    );

    return {
      id,
      name,
      scopes,
      expiresAt: expiresAt.toISOString(),
      createdAt,
      revokedAt: null,
      token,
    };
  }

  verify(token: string): AiAccessTokenPrincipal | null {
    if (!token.startsWith(AI_ACCESS_TOKEN_PREFIX)) return null;

    const row = this.sqliteService.getDatabase().prepare(`
      SELECT t.*, u.email
      FROM ai_access_tokens t
      INNER JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ?
        AND t.revoked_at IS NULL
        AND t.expires_at > ?
      LIMIT 1
    `).get(this.hash(token), new Date().toISOString()) as unknown as AiAccessTokenRow | undefined;

    if (!row?.email) return null;
    return {
      tokenId: row.id,
      userId: row.user_id,
      email: row.email,
      scopes: this.parseScopes(row.scopes_json),
    };
  }

  listByUser(userId: number): AiAccessTokenSummary[] {
    const rows = this.sqliteService.getDatabase().prepare(`
      SELECT * FROM ai_access_tokens
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(userId) as unknown as AiAccessTokenRow[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      scopes: this.parseScopes(row.scopes_json),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
    }));
  }

  revoke(userId: number, tokenId: string): boolean {
    const result = this.sqliteService.getDatabase().prepare(`
      UPDATE ai_access_tokens
      SET revoked_at = ?
      WHERE id = ? AND user_id = ? AND revoked_at IS NULL
    `).run(new Date().toISOString(), tokenId, userId);
    return result.changes > 0;
  }

  private hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private parseScopes(value: string): AiAccessScope[] {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (scope): scope is AiAccessScope => scope === "books:read" || scope === "annotations:read",
      );
    } catch {
      return [];
    }
  }
}
