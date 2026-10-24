import { LibrarySyncModule } from "../library-sync/library-sync.module";
import { CURRENT_BOOK_ARTIFACT_FENCE_PORT } from "../public/current-book-artifact-fence.port";
import { SqliteCurrentBookArtifactFence } from "./infrastructure/persistence/sqlite/sqlite-current-book-artifact-fence";
import { Module } from "@nestjs/common";
import { SqlitePersistenceModule } from "../../../platform/persistence/sqlite/sqlite-persistence.module";
import { StorageModule } from "../../../platform/storage/storage.module";
import { BOOK_REPOSITORY_PORT, type BookRepositoryPort } from "./application/ports/book-repository.port";
import { BOOK_DUPLICATE_QUERY_PORT, type BookDuplicateQueryPort } from "./application/ports/book-duplicate-query.port";
import { CATALOG_BOOK_VIEW_QUERY_PORT, type CatalogBookViewQueryPort } from "./application/ports/catalog-book-view-query.port";
import { BOOK_FILE_STREAMING_QUERY_PORT } from "./application/ports/book-file-streaming-query.port";
import { AddBookFromSearchUseCase } from "./application/use-cases/add-book-from-search.use-case";
import { ApplyBookMetadataService } from "./application/apply-book-metadata.service";
import { APPLY_BOOK_METADATA_PORT } from "./application/ports/apply-book-metadata.port";
import { BOOK_CONTENT_CATALOG_PORT } from "./application/ports/book-content-catalog.port";
import { BatchDeleteBooksUseCase } from "./application/use-cases/batch-delete-books.use-case";
import { CreateBookFileAccessUseCase } from "./application/use-cases/create-book-file-access.use-case";
import { CreateBookUseCase } from "./application/use-cases/create-book.use-case";
import { DeleteBookUseCase } from "./application/use-cases/delete-book.use-case";
import { ImportBookUseCase } from "./application/use-cases/import-book.use-case";
import { UpdateBookUseCase } from "./application/use-cases/update-book.use-case";
import { EpubMetadataParser } from "./infrastructure/epub-metadata.parser";
import { SqliteBookRepository } from "./infrastructure/persistence/sqlite/sqlite-book.repository";
import { SqliteBookArtifactRepository } from "./infrastructure/persistence/sqlite/sqlite-book-artifact.repository";
import { SqliteCatalogBookDeletionRepository } from "./infrastructure/persistence/sqlite/sqlite-catalog-book-deletion.repository";
import { SqliteBookDuplicateQuery } from "./infrastructure/persistence/sqlite/sqlite-book-duplicate.query";
import { SqliteCatalogBookViewQuery } from "./infrastructure/persistence/sqlite/sqlite-catalog-book-view.query";
import { SqliteBookContentCatalogQuery } from "./infrastructure/persistence/sqlite/sqlite-book-content-catalog.query";
import { SqliteBookFileStreamingQuery } from "./infrastructure/persistence/sqlite/sqlite-book-file-streaming.query";
import { StorageBookArtifactAdapter } from "./infrastructure/storage-book-artifact.adapter";
import { BOOK_ARTIFACT_REPOSITORY_PORT, type BookArtifactRepositoryPort } from "./application/ports/book-artifact-repository.port";
import { CATALOG_BOOK_DELETION_PORT, type CatalogBookDeletionPort } from "./application/ports/catalog-book-deletion.port";
import { BOOK_ARTIFACT_STORE_PORT, type BookArtifactStorePort } from "./application/ports/book-artifact-store.port";
import { AttachBookFileUseCase } from "./application/use-cases/attach-book-file.use-case";
import {
  PDF_PAGE_TREE_OPTIMIZER_PORT,
  type PdfPageTreeOptimizerPort,
} from "./application/ports/pdf-page-tree-optimizer.port";
import { QpdfPageTreeOptimizerAdapter } from "./infrastructure/qpdf-page-tree-optimizer.adapter";
import { DetachBookFileUseCase } from "./application/use-cases/detach-book-file.use-case";
import { CollectBookArtifactsUseCase } from "./application/use-cases/collect-book-artifacts.use-case";
import { IMPORTED_FILE_STORE_PORT, type ImportedFileStorePort } from "./application/ports/imported-file-store.port";
import { IMPORTED_BOOK_INSPECTOR_PORT, type ImportedBookInspectorPort } from "./application/ports/imported-book-inspector.port";
import { LocalImportedFileStoreAdapter } from "./infrastructure/local-imported-file-store.adapter";
import { ImportedBookInspectorAdapter } from "./infrastructure/imported-book-inspector.adapter";
import { BookArtifactGcWorker } from "./infrastructure/book-artifact-gc.worker";
import { GetBookReadingProfileUseCase } from "./application/use-cases/get-book-reading-profile.use-case";
import { EditBookReadingProfileUseCase } from "./application/use-cases/edit-book-reading-profile.use-case";
import { ClearBookReadingProfileUseCase } from "./application/use-cases/clear-book-reading-profile.use-case";
import {
  APPLY_BOOK_READING_PROFILE_CANDIDATE_PORT,
} from "./application/ports/apply-book-reading-profile-candidate.port";
import { ApplyBookReadingProfileCandidateUseCase } from "./application/use-cases/apply-book-reading-profile-candidate.use-case";

@Module({
  imports: [LibrarySyncModule, SqlitePersistenceModule, StorageModule],
  providers: [
    SqliteCurrentBookArtifactFence,
    { provide: CURRENT_BOOK_ARTIFACT_FENCE_PORT, useExisting: SqliteCurrentBookArtifactFence },
    SqliteBookRepository,
    SqliteBookArtifactRepository,
    SqliteCatalogBookDeletionRepository,
    SqliteBookDuplicateQuery,
    SqliteCatalogBookViewQuery,
    SqliteBookContentCatalogQuery,
    SqliteBookFileStreamingQuery,
    StorageBookArtifactAdapter,
    CollectBookArtifactsUseCase,
    BookArtifactGcWorker,
    { provide: BOOK_REPOSITORY_PORT, useExisting: SqliteBookRepository },
    { provide: BOOK_ARTIFACT_REPOSITORY_PORT, useExisting: SqliteBookArtifactRepository },
    { provide: CATALOG_BOOK_DELETION_PORT, useExisting: SqliteCatalogBookDeletionRepository },
    { provide: BOOK_ARTIFACT_STORE_PORT, useExisting: StorageBookArtifactAdapter },
    QpdfPageTreeOptimizerAdapter,
    { provide: PDF_PAGE_TREE_OPTIMIZER_PORT, useExisting: QpdfPageTreeOptimizerAdapter },
    { provide: BOOK_DUPLICATE_QUERY_PORT, useExisting: SqliteBookDuplicateQuery },
    { provide: CATALOG_BOOK_VIEW_QUERY_PORT, useExisting: SqliteCatalogBookViewQuery },
    { provide: BOOK_FILE_STREAMING_QUERY_PORT, useExisting: SqliteBookFileStreamingQuery },
    { provide: BOOK_CONTENT_CATALOG_PORT, useExisting: SqliteBookContentCatalogQuery },
    EpubMetadataParser,
    LocalImportedFileStoreAdapter,
    ImportedBookInspectorAdapter,
    { provide: IMPORTED_FILE_STORE_PORT, useExisting: LocalImportedFileStoreAdapter },
    { provide: IMPORTED_BOOK_INSPECTOR_PORT, useExisting: ImportedBookInspectorAdapter },
    {
      provide: AttachBookFileUseCase,
      inject: [
        BOOK_REPOSITORY_PORT,
        BOOK_ARTIFACT_REPOSITORY_PORT,
        BOOK_ARTIFACT_STORE_PORT,
        PDF_PAGE_TREE_OPTIMIZER_PORT,
      ],
      useFactory: (
        books: BookRepositoryPort,
        artifactRepository: BookArtifactRepositoryPort,
        artifacts: BookArtifactStorePort,
        pdfPageTrees: PdfPageTreeOptimizerPort,
      ) => new AttachBookFileUseCase(books, artifactRepository, artifacts, pdfPageTrees),
    },
    {
      provide: DetachBookFileUseCase,
      inject: [BOOK_ARTIFACT_REPOSITORY_PORT, BOOK_ARTIFACT_STORE_PORT],
      useFactory: (
        artifactRepository: BookArtifactRepositoryPort,
        artifacts: BookArtifactStorePort,
      ) => new DetachBookFileUseCase(artifactRepository, artifacts),
    },
    {
      provide: CollectBookArtifactsUseCase,
      inject: [BOOK_ARTIFACT_REPOSITORY_PORT, BOOK_ARTIFACT_STORE_PORT],
      useFactory: (
        artifactRepository: BookArtifactRepositoryPort,
        artifacts: BookArtifactStorePort,
      ) => new CollectBookArtifactsUseCase(artifactRepository, artifacts),
    },
    {
      provide: ApplyBookMetadataService,
      inject: [BOOK_REPOSITORY_PORT, CATALOG_BOOK_VIEW_QUERY_PORT],
      useFactory: (books: BookRepositoryPort, views: CatalogBookViewQueryPort) =>
        new ApplyBookMetadataService(books, views),
    },
    { provide: APPLY_BOOK_METADATA_PORT, useExisting: ApplyBookMetadataService },
    {
      provide: CreateBookUseCase,
      inject: [BOOK_REPOSITORY_PORT, BOOK_DUPLICATE_QUERY_PORT, CATALOG_BOOK_VIEW_QUERY_PORT],
      useFactory: (
        books: BookRepositoryPort,
        duplicates: BookDuplicateQueryPort,
        views: CatalogBookViewQueryPort,
      ) => new CreateBookUseCase(books, duplicates, views),
    },
    {
      provide: AddBookFromSearchUseCase,
      inject: [CreateBookUseCase],
      useFactory: (createBook: CreateBookUseCase) => new AddBookFromSearchUseCase(createBook),
    },
    {
      provide: UpdateBookUseCase,
      inject: [BOOK_REPOSITORY_PORT, CATALOG_BOOK_VIEW_QUERY_PORT],
      useFactory: (books: BookRepositoryPort, views: CatalogBookViewQueryPort) =>
        new UpdateBookUseCase(books, views),
    },
    {
      provide: DeleteBookUseCase,
      inject: [CATALOG_BOOK_DELETION_PORT],
      useFactory: (deletion: CatalogBookDeletionPort) => new DeleteBookUseCase(deletion),
    },
    {
      provide: BatchDeleteBooksUseCase,
      inject: [CATALOG_BOOK_DELETION_PORT],
      useFactory: (deletion: CatalogBookDeletionPort) => new BatchDeleteBooksUseCase(deletion),
    },
    CreateBookFileAccessUseCase,
    {
      provide: GetBookReadingProfileUseCase,
      inject: [BOOK_REPOSITORY_PORT],
      useFactory: (books: BookRepositoryPort) => new GetBookReadingProfileUseCase(books),
    },
    {
      provide: EditBookReadingProfileUseCase,
      inject: [BOOK_REPOSITORY_PORT],
      useFactory: (books: BookRepositoryPort) => new EditBookReadingProfileUseCase(books),
    },
    {
      provide: ClearBookReadingProfileUseCase,
      inject: [BOOK_REPOSITORY_PORT],
      useFactory: (books: BookRepositoryPort) => new ClearBookReadingProfileUseCase(books),
    },
    {
      provide: ApplyBookReadingProfileCandidateUseCase,
      inject: [BOOK_REPOSITORY_PORT],
      useFactory: (books: BookRepositoryPort) => new ApplyBookReadingProfileCandidateUseCase(books),
    },
    {
      provide: APPLY_BOOK_READING_PROFILE_CANDIDATE_PORT,
      useExisting: ApplyBookReadingProfileCandidateUseCase,
    },
    {
      provide: ImportBookUseCase,
      inject: [
        BOOK_REPOSITORY_PORT,
        BOOK_DUPLICATE_QUERY_PORT,
        CATALOG_BOOK_VIEW_QUERY_PORT,
        IMPORTED_FILE_STORE_PORT,
        IMPORTED_BOOK_INSPECTOR_PORT,
        AttachBookFileUseCase,
      ],
      useFactory: (
        books: BookRepositoryPort,
        duplicates: BookDuplicateQueryPort,
        views: CatalogBookViewQueryPort,
        files: ImportedFileStorePort,
        inspector: ImportedBookInspectorPort,
        attachFile: AttachBookFileUseCase,
      ) => new ImportBookUseCase(books, duplicates, views, files, inspector, attachFile),
    },
  ],
  exports: [
    CURRENT_BOOK_ARTIFACT_FENCE_PORT,
    BOOK_REPOSITORY_PORT,
    BOOK_DUPLICATE_QUERY_PORT,
    CATALOG_BOOK_VIEW_QUERY_PORT,
    BOOK_FILE_STREAMING_QUERY_PORT,
    BOOK_CONTENT_CATALOG_PORT,
    APPLY_BOOK_METADATA_PORT,
    AddBookFromSearchUseCase,
    BatchDeleteBooksUseCase,
    CreateBookFileAccessUseCase,
    CreateBookUseCase,
    DeleteBookUseCase,
    ImportBookUseCase,
    UpdateBookUseCase,
    AttachBookFileUseCase,
    DetachBookFileUseCase,
    CollectBookArtifactsUseCase,
    GetBookReadingProfileUseCase,
    EditBookReadingProfileUseCase,
    ClearBookReadingProfileUseCase,
    APPLY_BOOK_READING_PROFILE_CANDIDATE_PORT,
  ],
})
export class CatalogModule {}
