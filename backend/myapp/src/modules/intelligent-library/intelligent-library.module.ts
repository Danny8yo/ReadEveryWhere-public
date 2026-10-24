import { LibrarySyncModule } from "./library-sync/library-sync.module";
import { Module } from "@nestjs/common";
import { SqlitePersistenceModule } from "../../platform/persistence/sqlite/sqlite-persistence.module";
import { StorageModule } from "../../platform/storage/storage.module";
import { BookAnalysisModule } from "./book-analysis/book-analysis.module";
import { BookContentModule } from "./book-content/book-content.module";
import { SqliteBookOwnershipAdapter } from "./catalog/infrastructure/persistence/sqlite/sqlite-book-ownership.adapter";
import { CatalogAcquisitionAdapter } from "./catalog/infrastructure/catalog-acquisition.adapter";
import { CatalogModule } from "./catalog/catalog.module";
import { LibraryQueryService } from "./library-queries/application/library-query.service";
import { LibraryQueriesModule } from "./library-queries/library-queries.module";
import { BOOK_OWNERSHIP_PORT } from "./public/book-ownership.port";
import { LIBRARY_QUERY_PORT } from "./public/library-query.port";
import {
  ATTACH_BOOK_FILE_PORT,
  BOOK_FILE_STATUS_QUERY_PORT,
} from "./public/book-file-acquisition.port";
import { BOOK_SOURCE_REFERENCE_QUERY_PORT } from "./public/book-source-reference-query.port";
import { MetadataEnrichmentModule } from "./metadata-enrichment/metadata-enrichment.module";

@Module({
  imports: [LibrarySyncModule,
    SqlitePersistenceModule,
    StorageModule,
    CatalogModule,
    BookContentModule,
    BookAnalysisModule,
    LibraryQueriesModule,
    MetadataEnrichmentModule,
  ],
  providers: [
    SqliteBookOwnershipAdapter,
    CatalogAcquisitionAdapter,
    {
      provide: BOOK_OWNERSHIP_PORT,
      useExisting: SqliteBookOwnershipAdapter,
    },
    {
      provide: LIBRARY_QUERY_PORT,
      useExisting: LibraryQueryService,
    },
    { provide: BOOK_SOURCE_REFERENCE_QUERY_PORT, useExisting: CatalogAcquisitionAdapter },
    { provide: BOOK_FILE_STATUS_QUERY_PORT, useExisting: CatalogAcquisitionAdapter },
    { provide: ATTACH_BOOK_FILE_PORT, useExisting: CatalogAcquisitionAdapter },
  ],
  exports: [LibrarySyncModule,
    CatalogModule,
    BookContentModule,
    BOOK_OWNERSHIP_PORT,
    LIBRARY_QUERY_PORT,
    BOOK_SOURCE_REFERENCE_QUERY_PORT,
    BOOK_FILE_STATUS_QUERY_PORT,
    ATTACH_BOOK_FILE_PORT,
    MetadataEnrichmentModule,
  ],
})
export class IntelligentLibraryModule {}
