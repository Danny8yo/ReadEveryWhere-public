import { RealtimeModule } from "../../platform/realtime/sse-transport";
import { IdentityModule } from "../identity/public";
import { Module } from "@nestjs/common";
import { AnnotationsModule } from "./annotations/annotations.module";
import { BookmarksModule } from "./bookmarks/bookmarks.module";
import { ReadingProgressModule } from "./reading-progress/reading-progress.module";
import {
  BOOK_OWNERSHIP_PORT,
  IntelligentLibraryModule,
  type BookOwnershipPort,
} from "../intelligent-library/public";
import { ReadingStateCoreModule } from "./reading-state-core.module";
import { GetReadingStateUseCase } from "./application/get-reading-state.use-case";
import { ReadingStateController } from "./presentation/reading-state.controller";
import {
  READING_PROGRESS_REPOSITORY_PORT,
  type ReadingProgressRepositoryPort,
} from "./reading-progress/application/ports/reading-progress-repository.port";
import {
  BOOKMARK_REPOSITORY_PORT,
  type BookmarkRepositoryPort,
} from "./bookmarks/application/ports/bookmark-repository.port";
import {
  ANNOTATION_REPOSITORY_PORT,
  type AnnotationRepositoryPort,
} from "./annotations/application/ports/annotation-repository.port";
import {
  READING_STATE_VERSION_PORT,
  type ReadingStateVersionPort,
} from "./application/ports/reading-state-version.port";

@Module({
  imports: [IdentityModule, RealtimeModule,
    IntelligentLibraryModule,
    ReadingStateCoreModule,
    AnnotationsModule,
    BookmarksModule,
    ReadingProgressModule,
  ],
  controllers: [ReadingStateController],
  providers: [
    {
      provide: GetReadingStateUseCase,
      inject: [
        READING_PROGRESS_REPOSITORY_PORT,
        BOOKMARK_REPOSITORY_PORT,
        ANNOTATION_REPOSITORY_PORT,
        READING_STATE_VERSION_PORT,
        BOOK_OWNERSHIP_PORT,
      ],
      useFactory: (
        progress: ReadingProgressRepositoryPort,
        bookmarks: BookmarkRepositoryPort,
        annotations: AnnotationRepositoryPort,
        versions: ReadingStateVersionPort,
        ownership: BookOwnershipPort,
      ) => new GetReadingStateUseCase(progress, bookmarks, annotations, versions, ownership),
    },
  ],
  exports: [AnnotationsModule],
})
export class ReadingStateModule {}
