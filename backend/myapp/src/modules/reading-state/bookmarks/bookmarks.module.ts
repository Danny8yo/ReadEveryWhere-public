import { Module } from "@nestjs/common";
import { SqlitePersistenceModule } from "../../../platform/persistence/sqlite/sqlite-persistence.module";
import {
  BOOK_OWNERSHIP_PORT,
  IntelligentLibraryModule,
  type BookOwnershipPort,
} from "../../intelligent-library/public";
import {
  BOOKMARK_REPOSITORY_PORT,
  type BookmarkRepositoryPort,
} from "./application/ports/bookmark-repository.port";
import { CreateBookmarkUseCase } from "./application/use-cases/create-bookmark.use-case";
import { DeleteBookmarkUseCase } from "./application/use-cases/delete-bookmark.use-case";
import { ListBookmarksUseCase } from "./application/use-cases/list-bookmarks.use-case";
import { SqliteBookmarkRepository } from "./infrastructure/sqlite-bookmark.repository";
import { BookmarksController } from "./presentation/bookmarks.controller";
import { ReadingStateCoreModule } from "../reading-state-core.module";
import { READING_STATE_CHANGE_PORT, type ReadingStateChangePort } from "../application/ports/reading-state-change.port";

@Module({
  imports: [SqlitePersistenceModule, IntelligentLibraryModule, ReadingStateCoreModule],
  controllers: [BookmarksController],
  providers: [
    SqliteBookmarkRepository,
    {
      provide: BOOKMARK_REPOSITORY_PORT,
      useExisting: SqliteBookmarkRepository,
    },
    {
      provide: CreateBookmarkUseCase,
      inject: [BOOKMARK_REPOSITORY_PORT, BOOK_OWNERSHIP_PORT, READING_STATE_CHANGE_PORT],
      useFactory: (
        repository: BookmarkRepositoryPort,
        bookOwnership: BookOwnershipPort,
        changes: ReadingStateChangePort,
      ) => new CreateBookmarkUseCase(repository, bookOwnership, changes),
    },
    {
      provide: ListBookmarksUseCase,
      inject: [BOOKMARK_REPOSITORY_PORT],
      useFactory: (repository: BookmarkRepositoryPort) =>
        new ListBookmarksUseCase(repository),
    },
    {
      provide: DeleteBookmarkUseCase,
      inject: [BOOKMARK_REPOSITORY_PORT, READING_STATE_CHANGE_PORT],
      useFactory: (repository: BookmarkRepositoryPort, changes: ReadingStateChangePort) =>
        new DeleteBookmarkUseCase(repository, changes),
    },
  ],
  exports: [BOOKMARK_REPOSITORY_PORT],
})
export class BookmarksModule {}
