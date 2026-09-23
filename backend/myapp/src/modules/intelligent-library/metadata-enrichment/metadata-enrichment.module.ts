import { LibrarySyncModule } from "../library-sync/library-sync.module";
import { Module } from "@nestjs/common";
import { CryptoModule } from "../../../platform/crypto/crypto.module";
import { SqlitePersistenceModule } from "../../../platform/persistence/sqlite/sqlite-persistence.module";
import {
  DOUBAN_RATING_SOURCE_PORT,
  AI_METADATA_SOURCE_PORT,
  METADATA_SOURCE_CONTEXT_PORT,
  METADATA_SOURCE_PORTS,
  DoubanRatingSourcePort,
  MetadataSourceContextPort,
  MetadataSourcePort,
} from "../public/metadata-source.port";
import { DoubanConfigService } from "./application/douban-config.service";
import { MetadataOrchestratorService } from "./application/metadata-orchestrator.service";
import {
  DOUBAN_SETTINGS_PORT,
  type DoubanSettingsPort,
} from "./application/ports/douban-settings.port";
import { SearchDoubanRatingUseCase } from "./application/search-douban-rating.use-case";
import { ApplyMetadataUseCase } from "./application/use-cases/apply-metadata.use-case";
import {
  APPLY_BOOK_METADATA_PORT,
  type ApplyBookMetadataPort,
} from "../catalog/application/ports/apply-book-metadata.port";
import { CatalogModule } from "../catalog/catalog.module";
import { BookContentModule } from "../book-content/book-content.module";
import { BOOK_METADATA_CONTENT_PORT, type BookMetadataContentPort } from "../public/book-metadata-content.port";
import { METADATA_GENERATION_MODEL_PORT, type MetadataGenerationModelPort } from "./application/ports/metadata-generation-model.port";
import { GenerateBookMetadataUseCase } from "./application/use-cases/generate-book-metadata.use-case";
import { AiMetadataProvider } from "./infrastructure/ai-metadata.provider";
import { AiMetadataModelAdapter } from "./infrastructure/ai-metadata.model.adapter";
import { UserDoubanConfigRepository } from "./infrastructure/user-douban-config.repository";
import { DoubanConfigController } from "./presentation/douban-config.controller";
import { MetadataController } from "./presentation/metadata.controller";
import { SaveDoubanRatingUseCase } from "./application/save-douban-rating.use-case";
import { SqliteBookDoubanRatingRepository } from "./infrastructure/sqlite-book-douban-rating.repository";
import { BOOK_DOUBAN_RATING_REPOSITORY, type BookDoubanRatingRepository } from "./application/ports/book-douban-rating.repository";
import { CATALOG_BOOK_VIEW_QUERY_PORT, type CatalogBookViewQueryPort } from "../catalog/application/ports/catalog-book-view-query.port";

@Module({
  imports: [LibrarySyncModule, SqlitePersistenceModule, CryptoModule, CatalogModule, BookContentModule],
  controllers: [MetadataController, DoubanConfigController],
  providers: [
    AiMetadataModelAdapter,
    { provide: METADATA_GENERATION_MODEL_PORT, useExisting: AiMetadataModelAdapter },
    AiMetadataProvider,
    { provide: AI_METADATA_SOURCE_PORT, useExisting: AiMetadataProvider },
    {
      provide: GenerateBookMetadataUseCase,
      inject: [BOOK_METADATA_CONTENT_PORT, METADATA_GENERATION_MODEL_PORT],
      useFactory: (content: BookMetadataContentPort, model: MetadataGenerationModelPort) =>
        new GenerateBookMetadataUseCase(content, model),
    },
    UserDoubanConfigRepository,
    SqliteBookDoubanRatingRepository,
    { provide: BOOK_DOUBAN_RATING_REPOSITORY, useExisting: SqliteBookDoubanRatingRepository },
    { provide: DOUBAN_SETTINGS_PORT, useExisting: UserDoubanConfigRepository },
    {
      provide: MetadataOrchestratorService,
      inject: [
        METADATA_SOURCE_CONTEXT_PORT,
        DOUBAN_SETTINGS_PORT,
        METADATA_SOURCE_PORTS,
        CATALOG_BOOK_VIEW_QUERY_PORT,
      ],
      useFactory: (
        sourceContext: MetadataSourceContextPort,
        doubanSettings: DoubanSettingsPort,
        sources: readonly MetadataSourcePort[],
        catalogBooks: CatalogBookViewQueryPort,
      ) => new MetadataOrchestratorService(
        sourceContext,
        doubanSettings,
        sources,
        process.env.DOUBAN_COOKIE ?? "",
        catalogBooks,
      ),
    },
    {
      provide: ApplyMetadataUseCase,
      inject: [APPLY_BOOK_METADATA_PORT],
      useFactory: (catalog: ApplyBookMetadataPort) => new ApplyMetadataUseCase(catalog),
    },
    {
      provide: SaveDoubanRatingUseCase,
      inject: [CATALOG_BOOK_VIEW_QUERY_PORT, BOOK_DOUBAN_RATING_REPOSITORY],
      useFactory: (
        books: CatalogBookViewQueryPort,
        ratings: BookDoubanRatingRepository,
      ) => new SaveDoubanRatingUseCase(books, ratings),
    },
    {
      provide: SearchDoubanRatingUseCase,
      inject: [DOUBAN_RATING_SOURCE_PORT, DOUBAN_SETTINGS_PORT],
      useFactory: (
        source: DoubanRatingSourcePort,
        settings: DoubanSettingsPort,
      ) => new SearchDoubanRatingUseCase(
        source,
        settings,
        process.env.DOUBAN_COOKIE ?? "",
      ),
    },
    {
      provide: DoubanConfigService,
      inject: [DOUBAN_SETTINGS_PORT],
      useFactory: (settings: DoubanSettingsPort) => new DoubanConfigService(
        settings,
        Number(process.env.DOUBAN_REQUEST_INTERVAL_MS || "3000"),
      ),
    },
  ],
  exports: [AI_METADATA_SOURCE_PORT],
})
export class MetadataEnrichmentModule {}
