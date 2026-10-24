import { BOOK_STRUCTURED_CONTENT_PORT } from "../public/book-structured-content.port";
import { BookStructuredContentService } from "./application/book-structured-content.service";
import { resolve } from "node:path";
import { SqlitePersistenceModule } from "../../../platform/persistence/sqlite/sqlite-persistence.module";
import { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import { BOOK_RETRIEVAL_PORT } from "../public/book-retrieval.port";
import { BookRetrievalService } from "./application/book-retrieval.service";
import { SqliteKeywordIndexRepository } from "./infrastructure/sqlite-keyword-index.repository";
import { KeywordIndexWorkerAdapter, contentIndexPipeline } from "./infrastructure/keyword-index-worker.adapter";
import {
  EPUB_SELECTION_RESOLVER_PORT,
  type EpubSelectionResolverPort,
} from "./application/ports/epub-selection-resolver.port";
import { EpubSelectionResolverAdapter } from "./infrastructure/epub-selection-resolver.adapter";
import { BOOK_SELECTION_PORT } from "../public/book-selection.port";
import {
  CURRENT_BOOK_ARTIFACT_FENCE_PORT,
  type CurrentBookArtifactFencePort,
} from "../public/current-book-artifact-fence.port";
import { ResolveBookSelectionService } from "./application/resolve-book-selection.service";
import { Module } from "@nestjs/common";
import {
  BOOK_CONTENT_CATALOG_PORT,
  type BookContentCatalogPort,
} from "../catalog/application/ports/book-content-catalog.port";
import { CatalogModule } from "../catalog/catalog.module";
import { BookDocumentLoader } from "./application/book-document.loader";
import {
  BOOK_CONTENT_SOURCE_PORT,
  type BookContentSourcePort,
} from "./application/ports/book-content-source.port";
import {
  BOOK_DOCUMENT_CACHE_PORT,
  type BookDocumentCachePort,
} from "./application/ports/book-document-cache.port";
import {
  BOOK_DOCUMENT_EXTRACTOR_PORT,
  type BookDocumentExtractorPort,
} from "./application/ports/book-document-extractor.port";
import { GetBookTocUseCase } from "./application/use-cases/get-book-toc.use-case";
import { ReadBookFromTocUseCase } from "./application/use-cases/read-book-from-toc.use-case";
import { ReadBookUseCase } from "./application/use-cases/read-book.use-case";
import { ReplayBookRangeUseCase } from "./application/use-cases/replay-book-range.use-case";
import { ResolveReaderFocusUseCase } from "./application/use-cases/resolve-reader-focus.use-case";
import { ResolveTocNodeReadTargetUseCase } from "./application/use-cases/resolve-toc-node-read-target.use-case";
import { SearchBookSemanticallyUseCase } from "./application/use-cases/search-book-semantically.use-case";
import { SearchBookTextUseCase } from "./application/use-cases/search-book-text.use-case";
import { BookDocumentCacheRepository } from "./infrastructure/book-document-cache.repository";
import { CatalogBookContentSourceAdapter } from "./infrastructure/catalog-book-content-source.adapter";
import { EpubDocumentExtractor } from "./infrastructure/epub-document.extractor";
import { BOOK_CONTENT_ACCESS_PORT } from "../public/book-content-access.port";
import { BookContentAccessService } from "./application/book-content-access.service";
import { BookMetadataContentAdapter } from "./infrastructure/book-metadata-content.adapter";
import { BOOK_METADATA_CONTENT_PORT } from "../public/book-metadata-content.port";

@Module({
  imports: [SqlitePersistenceModule, CatalogModule],
  providers: [
    { provide: BOOK_STRUCTURED_CONTENT_PORT,
      inject: [BookDocumentLoader, GetBookTocUseCase, ReadBookUseCase, ReadBookFromTocUseCase, BOOK_RETRIEVAL_PORT, CURRENT_BOOK_ARTIFACT_FENCE_PORT],
      useFactory: (documents: BookDocumentLoader, toc: GetBookTocUseCase, read: ReadBookUseCase, batches: ReadBookFromTocUseCase,
        retrieval: import("../public/book-retrieval.port").BookRetrievalPort, fence: CurrentBookArtifactFencePort) =>
        new BookStructuredContentService(documents, toc, read, batches, retrieval, fence),
    },
    {
      provide: BOOK_RETRIEVAL_PORT,
      inject: [
        CatalogBookContentSourceAdapter,
        CURRENT_BOOK_ARTIFACT_FENCE_PORT,
        BOOK_DOCUMENT_EXTRACTOR_PORT,
        SqliteService,
      ],
      useFactory: (
        source: CatalogBookContentSourceAdapter,
        fence: CurrentBookArtifactFencePort,
        extractor: BookDocumentExtractorPort,
        sqlite: SqliteService,
      ) =>
        new BookRetrievalService(
          source,
          fence,
          extractor,
          new KeywordIndexWorkerAdapter(contentIndexPipeline(process.env.CONTENT_INDEX_PIPELINE)),
          new SqliteKeywordIndexRepository(sqlite.getDatabase(), fence, resolve(process.env.DOWNLOAD_STORAGE_PATH || "data/downloads", ".keyword-index")),
        ),
    },
    {
      provide: EPUB_SELECTION_RESOLVER_PORT,
      useClass: EpubSelectionResolverAdapter,
    },
    {
      provide: BOOK_SELECTION_PORT,
      inject: [
        CatalogBookContentSourceAdapter,
        CURRENT_BOOK_ARTIFACT_FENCE_PORT,
        BOOK_DOCUMENT_EXTRACTOR_PORT,
        EPUB_SELECTION_RESOLVER_PORT,
      ],
      useFactory: (
        source: CatalogBookContentSourceAdapter,
        fence: CurrentBookArtifactFencePort,
        extractor: BookDocumentExtractorPort,
        resolver: EpubSelectionResolverPort,
      ) => new ResolveBookSelectionService(source, fence, extractor, resolver),
    },
    {
      provide: CatalogBookContentSourceAdapter,
      inject: [BOOK_CONTENT_CATALOG_PORT],
      useFactory: (catalog: BookContentCatalogPort) =>
        new CatalogBookContentSourceAdapter(catalog),
    },
    {
      provide: BOOK_CONTENT_SOURCE_PORT,
      useExisting: CatalogBookContentSourceAdapter,
    },
    BookDocumentCacheRepository,
    {
      provide: BOOK_DOCUMENT_CACHE_PORT,
      useExisting: BookDocumentCacheRepository,
    },
    EpubDocumentExtractor,
    {
      provide: BOOK_DOCUMENT_EXTRACTOR_PORT,
      useExisting: EpubDocumentExtractor,
    },
    {
      provide: BookDocumentLoader,
      inject: [
        BOOK_CONTENT_SOURCE_PORT,
        BOOK_DOCUMENT_EXTRACTOR_PORT,
        BOOK_DOCUMENT_CACHE_PORT,
      ],
      useFactory: (
        source: BookContentSourcePort,
        extractor: BookDocumentExtractorPort,
        cache: BookDocumentCachePort,
      ) => new BookDocumentLoader(source, extractor, cache),
    },
    {
      provide: GetBookTocUseCase,
      inject: [BookDocumentLoader],
      useFactory: (documents: BookDocumentLoader) =>
        new GetBookTocUseCase(documents),
    },
    {
      provide: ReadBookUseCase,
      inject: [BOOK_CONTENT_SOURCE_PORT, BookDocumentLoader],
      useFactory: (
        source: BookContentSourcePort,
        documents: BookDocumentLoader,
      ) => new ReadBookUseCase(source, documents),
    },
    {
      provide: ResolveTocNodeReadTargetUseCase,
      inject: [BookDocumentLoader],
      useFactory: (documents: BookDocumentLoader) =>
        new ResolveTocNodeReadTargetUseCase(documents),
    },
    {
      provide: ReadBookFromTocUseCase,
      inject: [BookDocumentLoader, ReadBookUseCase],
      useFactory: (documents: BookDocumentLoader, read: ReadBookUseCase) =>
        new ReadBookFromTocUseCase(documents, read),
    },
    {
      provide: ReplayBookRangeUseCase,
      inject: [BOOK_CONTENT_SOURCE_PORT, BookDocumentLoader],
      useFactory: (
        source: BookContentSourcePort,
        documents: BookDocumentLoader,
      ) => new ReplayBookRangeUseCase(source, documents),
    },
    {
      provide: ResolveReaderFocusUseCase,
      inject: [BookDocumentLoader],
      useFactory: (documents: BookDocumentLoader) =>
        new ResolveReaderFocusUseCase(documents),
    },
    {
      provide: SearchBookTextUseCase,
      inject: [BOOK_CONTENT_SOURCE_PORT, BookDocumentLoader],
      useFactory: (
        source: BookContentSourcePort,
        documents: BookDocumentLoader,
      ) => new SearchBookTextUseCase(source, documents),
    },
    {
      provide: SearchBookSemanticallyUseCase,
      inject: [BOOK_CONTENT_SOURCE_PORT],
      useFactory: (source: BookContentSourcePort) =>
        new SearchBookSemanticallyUseCase(source),
    },
    {
      provide: BookContentAccessService,
      inject: [
        BookDocumentLoader,
        GetBookTocUseCase,
        ReadBookUseCase,
        ReadBookFromTocUseCase,
        SearchBookTextUseCase,
        SearchBookSemanticallyUseCase,
        ResolveTocNodeReadTargetUseCase,
        ResolveReaderFocusUseCase,
        ReplayBookRangeUseCase,
      ],
      useFactory: (
        documents: BookDocumentLoader,
        toc: GetBookTocUseCase,
        read: ReadBookUseCase,
        readFromToc: ReadBookFromTocUseCase,
        textSearch: SearchBookTextUseCase,
        semanticSearch: SearchBookSemanticallyUseCase,
        tocTarget: ResolveTocNodeReadTargetUseCase,
        readerFocus: ResolveReaderFocusUseCase,
        replay: ReplayBookRangeUseCase,
      ) =>
        new BookContentAccessService(
          documents,
          toc,
          read,
          readFromToc,
          textSearch,
          semanticSearch,
          tocTarget,
          readerFocus,
          replay,
        ),
    },
    {
      provide: BOOK_CONTENT_ACCESS_PORT,
      useExisting: BookContentAccessService,
    },
    BookMetadataContentAdapter,
    {
      provide: BOOK_METADATA_CONTENT_PORT,
      useExisting: BookMetadataContentAdapter,
    },
  ],
  exports: [
    BOOK_STRUCTURED_CONTENT_PORT,
    BOOK_RETRIEVAL_PORT,
    BOOK_SELECTION_PORT,
    BookDocumentLoader,
    GetBookTocUseCase,
    ReadBookUseCase,
    ResolveTocNodeReadTargetUseCase,
    ReadBookFromTocUseCase,
    ReplayBookRangeUseCase,
    ResolveReaderFocusUseCase,
    SearchBookTextUseCase,
    SearchBookSemanticallyUseCase,
    BOOK_CONTENT_ACCESS_PORT,
    BOOK_METADATA_CONTENT_PORT,
  ],
})
export class BookContentModule {}
