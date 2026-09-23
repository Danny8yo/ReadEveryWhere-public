import { Inject, Injectable } from "@nestjs/common";
import { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import type {
  ReadingStateChangePort,
  ReadingStateMutationResult,
} from "../application/ports/reading-state-change.port";
import { ReadingStateEventBus } from "../application/reading-state-event-bus";
import {
  READING_STATE_VERSION_PORT,
  type ReadingStateVersionPort,
} from "../application/ports/reading-state-version.port";

@Injectable()
export class SqliteReadingStateChangeCoordinator implements ReadingStateChangePort {
  constructor(
    private readonly sqlite: SqliteService,
    private readonly events: ReadingStateEventBus,
    @Inject(READING_STATE_VERSION_PORT)
    private readonly versions: ReadingStateVersionPort,
  ) {}

  transact<T>(
    input: Parameters<ReadingStateChangePort["transact"]>[0],
    mutation: () => ReadingStateMutationResult<T>,
  ): T {
    const database = this.sqlite.getDatabase();
    database.exec("BEGIN IMMEDIATE");
    let result: ReadingStateMutationResult<T>;
    let revision: number | null = null;
    try {
      result = mutation();
      if (result.didChange) {
        if (result.bookId === null) {
          throw new Error("Changed reading-state mutation must identify its book");
        }
        revision = this.versions.bumpRevision(input.userId, result.bookId, Date.now());
      }
      database.exec("COMMIT");
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }

    if (revision !== null && result.bookId !== null) {
      this.events.publish({
        ...input,
        bookId: result.bookId,
        revision,
      });
    }
    return result.value;
  }
}
