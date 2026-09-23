import { Module } from "@nestjs/common";
import { SqlitePersistenceModule } from "../../platform/persistence/sqlite/sqlite-persistence.module";
import { READING_STATE_CHANGE_PORT } from "./application/ports/reading-state-change.port";
import { READING_STATE_VERSION_PORT } from "./application/ports/reading-state-version.port";
import { ReadingStateEventBus } from "./application/reading-state-event-bus";
import { SqliteReadingStateChangeCoordinator } from "./infrastructure/sqlite-reading-state-change-coordinator";
import { SqliteReadingStateVersionRepository } from "./infrastructure/sqlite-reading-state-version.repository";

@Module({
  imports: [SqlitePersistenceModule],
  providers: [
    ReadingStateEventBus,
    SqliteReadingStateChangeCoordinator,
    SqliteReadingStateVersionRepository,
    { provide: READING_STATE_CHANGE_PORT, useExisting: SqliteReadingStateChangeCoordinator },
    { provide: READING_STATE_VERSION_PORT, useExisting: SqliteReadingStateVersionRepository },
  ],
  exports: [ReadingStateEventBus, READING_STATE_CHANGE_PORT, READING_STATE_VERSION_PORT],
})
export class ReadingStateCoreModule {}
