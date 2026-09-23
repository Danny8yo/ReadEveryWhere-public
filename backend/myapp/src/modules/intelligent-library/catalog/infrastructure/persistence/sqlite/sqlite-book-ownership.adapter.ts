import { Injectable } from "@nestjs/common";
import { SqliteService } from "../../../../../../platform/persistence/sqlite/sqlite.service";
import type { BookOwnershipPort, BookOwnershipQuery } from "../../../../public";

@Injectable()
export class SqliteBookOwnershipAdapter implements BookOwnershipPort {
  constructor(private readonly sqliteService: SqliteService) {}

  isOwnedByUser(query: Readonly<BookOwnershipQuery>): boolean {
    const row = this.sqliteService
      .getDatabase()
      .prepare("SELECT 1 FROM books WHERE user_id = ? AND id = ?")
      .get(query.userId, query.bookId);
    return row !== undefined;
  }
}
