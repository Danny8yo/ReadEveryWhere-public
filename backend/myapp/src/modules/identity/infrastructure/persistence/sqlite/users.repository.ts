import { Injectable } from "@nestjs/common";
import type {
  IdentityUserRecord,
  UserRepositoryPort,
} from "../../../application/ports/user-repository.port";
import { SqliteService } from "../../../../../platform/persistence/sqlite/sqlite.service";

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class UsersRepository implements UserRepositoryPort {
  constructor(private readonly sqliteService: SqliteService) {}

  findByEmail(email: string): IdentityUserRecord | null {
    const database = this.sqliteService.getDatabase();
    const statement = database.prepare(
      `
        SELECT id, email, password_hash, created_at, updated_at
        FROM users
        WHERE email = ?
        LIMIT 1
      `,
    );

    return this.toRecord(statement.get(email) as UserRow | undefined);
  }

  findById(id: number): IdentityUserRecord | null {
    const database = this.sqliteService.getDatabase();
    const statement = database.prepare(
      `
        SELECT id, email, password_hash, created_at, updated_at
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
    );

    return this.toRecord(statement.get(id) as UserRow | undefined);
  }

  create(email: string, passwordHash: string): IdentityUserRecord {
    const now = new Date().toISOString();
    const database = this.sqliteService.getDatabase();
    const statement = database.prepare(
      `
        INSERT INTO users (email, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `,
    );

    const result = statement.run(email, passwordHash, now, now);
    const created = this.findById(Number(result.lastInsertRowid));
    if (!created) {
      throw new Error("Failed to load created user");
    }

    return created;
  }

  updatePasswordHash(id: number, passwordHash: string): IdentityUserRecord {
    const now = new Date().toISOString();
    const database = this.sqliteService.getDatabase();
    database
      .prepare(
        `
          UPDATE users
          SET password_hash = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(passwordHash, now, id);

    const updated = this.findById(id);
    if (!updated) {
      throw new Error("Failed to load updated user");
    }

    return updated;
  }

  private toRecord(row: UserRow | undefined): IdentityUserRecord | null {
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
