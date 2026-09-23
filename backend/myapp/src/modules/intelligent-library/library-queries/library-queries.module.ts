import { IdentityModule } from "../../identity/public";
import { RealtimeModule } from "../../../platform/realtime/sse-transport";
import { LibrarySyncController } from "../library-sync/library-sync.controller";
import { LibrarySyncModule } from "../library-sync/library-sync.module";
import { Module } from "@nestjs/common";
import { SqlitePersistenceModule } from "../../../platform/persistence/sqlite/sqlite-persistence.module";
import {
  BOOK_ANALYSIS_SUMMARY_QUERY_PORT,
  type BookAnalysisSummaryQueryPort,
} from "../book-analysis/application/ports/book-analysis-summary-query.port";
import { BookAnalysisModule } from "../book-analysis/book-analysis.module";
import { CatalogModule } from "../catalog/catalog.module";
import {
  BOOK_FILE_STREAMING_QUERY_PORT,
  type BookFileStreamingQueryPort,
} from "../catalog/application/ports/book-file-streaming-query.port";
import { GetLibraryBookUseCase } from "./application/get-library-book.use-case";
import { LibraryQueryService } from "./application/library-query.service";
import { ListLibraryBooksUseCase } from "./application/list-library-books.use-case";
import {
  LIBRARY_READ_MODEL_QUERY_PORT,
  type LibraryReadModelQueryPort,
} from "./application/ports/library-read-model-query.port";
import { SqliteLibraryReadModelQuery } from "./infrastructure/sqlite-library-read-model.query";
import { LibraryController } from "./presentation/http/library.controller";
import { StreamBookFileHttpService } from "./presentation/http/stream-book-file-http.service";

@Module({
  imports: [IdentityModule, RealtimeModule, LibrarySyncModule, CatalogModule, BookAnalysisModule, SqlitePersistenceModule],
  controllers: [LibraryController, LibrarySyncController],
  providers: [
    SqliteLibraryReadModelQuery,
    { provide: LIBRARY_READ_MODEL_QUERY_PORT, useExisting: SqliteLibraryReadModelQuery },
    {
      provide: StreamBookFileHttpService,
      inject: [BOOK_FILE_STREAMING_QUERY_PORT],
      useFactory: (files: BookFileStreamingQueryPort) => new StreamBookFileHttpService(files),
    },
    {
      provide: ListLibraryBooksUseCase,
      inject: [LIBRARY_READ_MODEL_QUERY_PORT, BOOK_ANALYSIS_SUMMARY_QUERY_PORT],
      useFactory: (
        library: LibraryReadModelQueryPort,
        analyses: BookAnalysisSummaryQueryPort,
      ) => new ListLibraryBooksUseCase(library, analyses),
    },
    {
      provide: GetLibraryBookUseCase,
      inject: [LIBRARY_READ_MODEL_QUERY_PORT, BOOK_ANALYSIS_SUMMARY_QUERY_PORT],
      useFactory: (
        library: LibraryReadModelQueryPort,
        analyses: BookAnalysisSummaryQueryPort,
      ) => new GetLibraryBookUseCase(library, analyses),
    },
    {
      provide: LibraryQueryService,
      inject: [LIBRARY_READ_MODEL_QUERY_PORT],
      useFactory: (library: LibraryReadModelQueryPort) => new LibraryQueryService(library),
    },
  ],
  exports: [LibraryQueryService],
})
export class LibraryQueriesModule {}
