import { ANNOTATION_SELECTION_RESOLVER_PORT, type AnnotationSelectionResolverPort } from "./application/ports/annotation-selection-resolver.port";
import { BookContentSelectionAdapter } from "./infrastructure/book-content-selection.adapter";
import { BOOK_SELECTION_PORT, type BookSelectionPort } from "../../intelligent-library/public";
import { ANNOTATION_SELECTION_COMMAND_PORT } from "../public/annotation-selection-command.port";
import { ANNOTATION_SELECTION_REPOSITORY_PORT, type AnnotationSelectionRepositoryPort } from "./application/ports/annotation-selection-repository.port";
import { ApplySelectionAnnotationUseCase } from "./application/use-cases/apply-selection-annotation.use-case";
import { SqliteAnnotationSelectionRepository } from "./infrastructure/sqlite-annotation-selection.repository";
import { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import { READING_STATE_VERSION_PORT, type ReadingStateVersionPort } from "../application/ports/reading-state-version.port";
import { Module } from "@nestjs/common";
import { SqlitePersistenceModule } from "../../../platform/persistence/sqlite/sqlite-persistence.module";
import {
  BOOK_OWNERSHIP_PORT,
  IntelligentLibraryModule,
  type BookOwnershipPort,
} from "../../intelligent-library/public";
import { ANNOTATION_QUERY_PORT } from "../public";
import {
  ANNOTATION_REPOSITORY_PORT,
  type AnnotationRepositoryPort,
} from "./application/ports/annotation-repository.port";
import { CreateAnnotationUseCase } from "./application/use-cases/create-annotation.use-case";
import { UpdateAnnotationUseCase } from "./application/use-cases/update-annotation.use-case";
import { ListAnnotationsUseCase } from "./application/use-cases/list-annotations.use-case";
import { DeleteAnnotationUseCase } from "./application/use-cases/delete-annotation.use-case";
import { SqliteAnnotationRepository } from "./infrastructure/sqlite-annotation.repository";
import { AnnotationController } from "./presentation/annotation.controller";
import { ReadingStateCoreModule } from "../reading-state-core.module";
import { READING_STATE_CHANGE_PORT, type ReadingStateChangePort } from "../application/ports/reading-state-change.port";

@Module({
  imports: [SqlitePersistenceModule, IntelligentLibraryModule, ReadingStateCoreModule],
  controllers: [AnnotationController],
  providers: [
    { provide: ANNOTATION_SELECTION_RESOLVER_PORT, inject: [BOOK_SELECTION_PORT],
      useFactory: (content: BookSelectionPort) => new BookContentSelectionAdapter(content) },
    { provide: ANNOTATION_SELECTION_REPOSITORY_PORT,
      inject: [SqliteService, ANNOTATION_REPOSITORY_PORT, BOOK_SELECTION_PORT, READING_STATE_CHANGE_PORT, READING_STATE_VERSION_PORT],
      useFactory: (sqlite: SqliteService, annotations: AnnotationRepositoryPort, selections: BookSelectionPort,
        changes: ReadingStateChangePort, versions: ReadingStateVersionPort) =>
        new SqliteAnnotationSelectionRepository(sqlite, annotations, selections, changes, versions) },
    { provide: ANNOTATION_SELECTION_COMMAND_PORT,
      inject: [ANNOTATION_SELECTION_REPOSITORY_PORT, ANNOTATION_REPOSITORY_PORT, ANNOTATION_SELECTION_RESOLVER_PORT],
      useFactory: (receipts: AnnotationSelectionRepositoryPort, annotations: AnnotationRepositoryPort, selections: AnnotationSelectionResolverPort) =>
        new ApplySelectionAnnotationUseCase(receipts, annotations, selections) },
    SqliteAnnotationRepository,
    { provide: ANNOTATION_REPOSITORY_PORT, useExisting: SqliteAnnotationRepository },
    { provide: ANNOTATION_QUERY_PORT, useExisting: SqliteAnnotationRepository },
    {
      provide: CreateAnnotationUseCase,
      inject: [ANNOTATION_REPOSITORY_PORT, BOOK_OWNERSHIP_PORT, READING_STATE_CHANGE_PORT],
      useFactory: (
        repository: AnnotationRepositoryPort,
        bookOwnership: BookOwnershipPort,
        changes: ReadingStateChangePort,
      ) => new CreateAnnotationUseCase(repository, bookOwnership, changes),
    },
    {
      provide: UpdateAnnotationUseCase,
      inject: [ANNOTATION_REPOSITORY_PORT, READING_STATE_CHANGE_PORT],
      useFactory: (repository: AnnotationRepositoryPort, changes: ReadingStateChangePort) =>
        new UpdateAnnotationUseCase(repository, changes),
    },
    {
      provide: ListAnnotationsUseCase,
      inject: [ANNOTATION_REPOSITORY_PORT],
      useFactory: (repository: AnnotationRepositoryPort) =>
        new ListAnnotationsUseCase(repository),
    },
    {
      provide: DeleteAnnotationUseCase,
      inject: [ANNOTATION_REPOSITORY_PORT, READING_STATE_CHANGE_PORT],
      useFactory: (repository: AnnotationRepositoryPort, changes: ReadingStateChangePort) =>
        new DeleteAnnotationUseCase(repository, changes),
    },
  ],
  exports: [ANNOTATION_QUERY_PORT, ANNOTATION_REPOSITORY_PORT, ANNOTATION_SELECTION_COMMAND_PORT],
})
export class AnnotationsModule {}
