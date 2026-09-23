import { Injectable } from "@nestjs/common";
import type { IdentityTransactionPort } from "../../../application/ports/identity-transaction.port";
import { SqliteService } from "../../../../../platform/persistence/sqlite/sqlite.service";

@Injectable()
export class SqliteIdentityTransaction implements IdentityTransactionPort {
  constructor(private readonly sqlite: SqliteService) {}

  run<T>(work: () => T): T {
    const db = this.sqlite.getDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
}
