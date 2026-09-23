import { Module } from "@nestjs/common";
import { SqlitePersistenceModule } from "../../../platform/persistence/sqlite/sqlite-persistence.module";
import {
  BOOK_OWNERSHIP_PORT,
  IntelligentLibraryModule,
  type BookOwnershipPort,
} from "../../intelligent-library/public";
import {
  READING_PROGRESS_REPOSITORY_PORT,
  type ReadingProgressRepositoryPort,
} from "./application/ports/reading-progress-repository.port";
import { GetProgressUseCase } from "./application/use-cases/get-progress.use-case";
import { UpsertProgressUseCase } from "./application/use-cases/upsert-progress.use-case";
import { SqliteReadingProgressRepository } from "./infrastructure/sqlite-reading-progress.repository";
import { ReadingProgressController } from "./presentation/reading-progress.controller";
import { ReadingStateCoreModule } from "../reading-state-core.module";
import { READING_STATE_CHANGE_PORT, type ReadingStateChangePort } from "../application/ports/reading-state-change.port";

@Module({
  imports: [SqlitePersistenceModule, IntelligentLibraryModule, ReadingStateCoreModule],
  controllers: [ReadingProgressController],
  providers: [
    SqliteReadingProgressRepository,
    {
      provide: READING_PROGRESS_REPOSITORY_PORT,
      useExisting: SqliteReadingProgressRepository,
    },
    {
      provide: UpsertProgressUseCase,
      inject: [READING_PROGRESS_REPOSITORY_PORT, BOOK_OWNERSHIP_PORT, READING_STATE_CHANGE_PORT],
      useFactory: (
        repository: ReadingProgressRepositoryPort,
        bookOwnership: BookOwnershipPort,
        changes: ReadingStateChangePort,
      ) => new UpsertProgressUseCase(repository, bookOwnership, changes),
    },
    {
      provide: GetProgressUseCase,
      inject: [READING_PROGRESS_REPOSITORY_PORT],
      useFactory: (repository: ReadingProgressRepositoryPort) =>
        new GetProgressUseCase(repository),
    },
  ],
  exports: [READING_PROGRESS_REPOSITORY_PORT],
})
export class ReadingProgressModule {}
