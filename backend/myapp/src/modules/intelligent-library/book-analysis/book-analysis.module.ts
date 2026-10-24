import { LibrarySyncModule } from "../library-sync/library-sync.module";
import { Module } from "@nestjs/common";
import {
  LANGUAGE_MODEL_GATEWAY,
  MODEL_CONFIG_PORT,
  MODEL_PROFILE_REGISTRY,
  type LanguageModelPort,
  type ModelCapabilityCatalog,
  type ModelConfigPort,
} from "../../../support/ai-model/public";
import { BookContentModule } from "../book-content/book-content.module";
import { BookDocumentLoader } from "../book-content/application/book-document.loader";
import { SqlitePersistenceModule } from "../../../platform/persistence/sqlite/sqlite-persistence.module";
import { CatalogModule } from "../catalog/catalog.module";
import {
  CATALOG_BOOK_VIEW_QUERY_PORT,
  type CatalogBookViewQueryPort,
} from "../catalog/application/ports/catalog-book-view-query.port";
import { BOOK_CONTENT_CATALOG_PORT, type BookContentCatalogPort } from "../catalog/application/ports/book-content-catalog.port";
import { BOOK_CLASSIFIER_PORT } from "./application/ports/book-classifier.port";
import { BOOK_ANALYSIS_MODEL_CAPABILITY_PORT } from "./application/ports/book-analysis-model-capability.port";
import {
  BOOK_ANALYSIS_MODEL_CONFIG_PORT,
  type BookAnalysisModelConfigPort,
} from "./application/ports/book-analysis-model-config.port";
import type { BookAnalysisModelCapabilityPort } from "./application/ports/book-analysis-model-capability.port";
import { BOOK_ANALYSIS_SUMMARY_QUERY_PORT } from "./application/ports/book-analysis-summary-query.port";
import { BatchBookAnalysisUseCase } from "./application/use-cases/batch-book-analysis.use-case";
import { ClassifyBookUseCase } from "./application/use-cases/classify-book.use-case";
import { GetBookAnalysisUseCase } from "./application/use-cases/get-book-analysis.use-case";
import { RequestBookAnalysisUseCase } from "./application/use-cases/request-book-analysis.use-case";
import { BookAnalysisRepository } from "./infrastructure/book-analysis.repository";
import { BookAnalysisSourceAdapter } from "./infrastructure/book-analysis-source.adapter";
import { BookAnalysisSummaryProjector } from "./infrastructure/book-analysis-summary.projector";
import { BookAnalysisWorker } from "./infrastructure/book-analysis.worker";
import { ApplyBookAnalysisCandidateUseCase } from "./application/use-cases/apply-book-analysis-candidate.use-case";
import {
  APPLY_BOOK_READING_PROFILE_CANDIDATE_PORT,
  type ApplyBookReadingProfileCandidatePort,
} from "../catalog/application/ports/apply-book-reading-profile-candidate.port";
import { LanguageModelBookClassifierAdapter } from "./infrastructure/language-model-book-classifier.adapter";
import { AiModelBookAnalysisAccessAdapter } from "./infrastructure/ai-model-book-analysis-access.adapter";
import { BookAnalysisController } from "./presentation/book-analysis.controller";
import {
  BOOK_ANALYSIS_CLASSIFICATION_OPTIONS,
  BOOK_ANALYSIS_STRATEGY_VERSION,
} from "./book-analysis.config";

export { BOOK_ANALYSIS_STRATEGY_VERSION } from "./book-analysis.config";

@Module({
  imports: [LibrarySyncModule, SqlitePersistenceModule, CatalogModule, BookContentModule],
  controllers: [BookAnalysisController],
  providers: [
    BookAnalysisRepository,
    {
      provide: AiModelBookAnalysisAccessAdapter,
      inject: [MODEL_CONFIG_PORT, MODEL_PROFILE_REGISTRY],
      useFactory: (
        modelConfigs: ModelConfigPort,
        modelProfiles: ModelCapabilityCatalog,
      ) => new AiModelBookAnalysisAccessAdapter(modelConfigs, modelProfiles),
    },
    { provide: BOOK_ANALYSIS_MODEL_CONFIG_PORT, useExisting: AiModelBookAnalysisAccessAdapter },
    { provide: BOOK_ANALYSIS_MODEL_CAPABILITY_PORT, useExisting: AiModelBookAnalysisAccessAdapter },
    {
      provide: BookAnalysisSourceAdapter,
      inject: [CATALOG_BOOK_VIEW_QUERY_PORT, BOOK_CONTENT_CATALOG_PORT, BookDocumentLoader],
      useFactory: (
        books: CatalogBookViewQueryPort,
        catalogFiles: BookContentCatalogPort,
        documents: BookDocumentLoader,
      ) => new BookAnalysisSourceAdapter(books, catalogFiles, documents),
    },
    BookAnalysisSummaryProjector,
    { provide: BOOK_ANALYSIS_SUMMARY_QUERY_PORT, useExisting: BookAnalysisSummaryProjector },
    {
      provide: LanguageModelBookClassifierAdapter,
      inject: [LANGUAGE_MODEL_GATEWAY],
      useFactory: (model: LanguageModelPort) => new LanguageModelBookClassifierAdapter(model),
    },
    {
      provide: BOOK_CLASSIFIER_PORT,
      useExisting: LanguageModelBookClassifierAdapter,
    },
    {
      provide: ClassifyBookUseCase,
      inject: [
        BookAnalysisSourceAdapter,
        BOOK_CLASSIFIER_PORT,
        BookAnalysisRepository,
        BOOK_ANALYSIS_MODEL_CONFIG_PORT,
      ],
      useFactory: (
        source: BookAnalysisSourceAdapter,
        classifier: LanguageModelBookClassifierAdapter,
        repository: BookAnalysisRepository,
        modelConfigs: BookAnalysisModelConfigPort,
      ) => new ClassifyBookUseCase(
        source,
        classifier,
        repository,
        modelConfigs,
        BOOK_ANALYSIS_CLASSIFICATION_OPTIONS,
      ),
    },
    {
      provide: RequestBookAnalysisUseCase,
      inject: [
        BookAnalysisSourceAdapter,
        BOOK_ANALYSIS_MODEL_CONFIG_PORT,
        BookAnalysisRepository,
        BOOK_ANALYSIS_MODEL_CAPABILITY_PORT,
      ],
      useFactory: (
        source: BookAnalysisSourceAdapter,
        modelConfigs: BookAnalysisModelConfigPort,
        repository: BookAnalysisRepository,
        modelCapabilities: BookAnalysisModelCapabilityPort,
      ) => new RequestBookAnalysisUseCase(
        source,
        source,
        modelConfigs,
        repository,
        { strategyVersion: BOOK_ANALYSIS_STRATEGY_VERSION },
        modelCapabilities,
      ),
    },
    {
      provide: BatchBookAnalysisUseCase,
      inject: [RequestBookAnalysisUseCase],
      useFactory: (requestAnalysis: RequestBookAnalysisUseCase) => (
        new BatchBookAnalysisUseCase(requestAnalysis, { maxBatchSize: 50 })
      ),
    },
    {
      provide: GetBookAnalysisUseCase,
      inject: [BookAnalysisSourceAdapter, BookAnalysisRepository],
      useFactory: (
        source: BookAnalysisSourceAdapter,
        repository: BookAnalysisRepository,
      ) => new GetBookAnalysisUseCase(
        source,
        source,
        repository,
        { strategyVersion: BOOK_ANALYSIS_STRATEGY_VERSION },
      ),
    },
    {
      provide: BookAnalysisWorker,
      inject: [BookAnalysisRepository, ClassifyBookUseCase],
      useFactory: (
        repository: BookAnalysisRepository,
        classifyBook: ClassifyBookUseCase,
      ) => new BookAnalysisWorker(repository, classifyBook, {
        concurrency: workerConcurrency(),
        leaseMs: 60_000,
        pollMs: 100,
      }),
    },
    {
      provide: ApplyBookAnalysisCandidateUseCase,
      inject: [APPLY_BOOK_READING_PROFILE_CANDIDATE_PORT, BookAnalysisSourceAdapter, BookAnalysisRepository],
      useFactory: (
        profiles: ApplyBookReadingProfileCandidatePort,
        source: BookAnalysisSourceAdapter,
        repository: BookAnalysisRepository,
      ) => new ApplyBookAnalysisCandidateUseCase(profiles, source, repository),
    },
  ],
  exports: [BOOK_ANALYSIS_SUMMARY_QUERY_PORT],
})
export class BookAnalysisModule {}

function workerConcurrency(): number {
  const configured = Number(process.env.BOOK_ANALYSIS_CONCURRENCY ?? 1);
  return Number.isInteger(configured) && configured >= 1
    ? Math.min(configured, 4)
    : 1;
}
