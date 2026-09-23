import { SelectionQaModule } from "./selection-qa/selection-qa.module";
import { Module } from "@nestjs/common";
import {
  BOOK_READING_PROFILE_ACCESS_PORT,
  BOOK_CONTENT_ACCESS_PORT,
  IntelligentLibraryModule,
  type BookReadingProfileAccessPort,
  type BookContentAccessPort,
} from "../intelligent-library/public";
import {
  AiModelSupportModule,
  LANGUAGE_MODEL_GATEWAY,
  MODEL_CONFIG_PORT,
  MODEL_PROFILE_REGISTRY,
  TOKEN_ESTIMATOR_REGISTRY,
  type LanguageModelPort,
  type ModelCapabilityCatalog,
  type ModelConfigPort,
  type TokenEstimatorCatalog,
} from "../../support/ai-model/public";
import { SqlitePersistenceModule } from "../../platform/persistence/sqlite/sqlite-persistence.module";
import { AiReadingService } from "./application/ai-reading.service";
import { ReadingConversationService } from "./application/reading-conversation.service";
import { ConversationEvidenceImportService } from './application/conversation-evidence-import.service';
import { AgentRunExecutor } from './application/agent-run-executor';
import { AgentContextWindow } from './application/context-window';
import { AiReadingScheduler } from './infrastructure/ai-reading-scheduler';
import { AgentRunRepository } from './infrastructure/agent-run.repository';
import { BudgetLedgerRepository } from './infrastructure/budget-ledger.repository';
import { EvidenceRepository } from './infrastructure/evidence.repository';
import { BookContentReadingToolsAdapter } from "./infrastructure/book-content-reading-tools.adapter";
import { NestTelemetryAdapter } from "./infrastructure/nest-telemetry.adapter";
import { ReadingTaskRepository } from "./infrastructure/reading-task.repository";
import { ReadingConversationRepository } from "./infrastructure/reading-conversation.repository";
import { AiReadingController } from "./presentation/ai-reading.controller";
import { AiReadingApplicationErrorInterceptor } from "./presentation/ai-reading-application-error.interceptor";
import { ReaderToolsHttpModule } from "../../interface-adapters/reader-tools-http/reader-tools-http.module";
import { GetBookMetadataUseCase } from "../../interface-adapters/reader-tools-http/application/get-book-metadata.use-case";
import { ListBookAnnotationsUseCase } from "../../interface-adapters/reader-tools-http/application/list-book-annotations.use-case";
import {
  AI_READING_LANGUAGE_MODEL_PORT,
  type LanguageModelPort as AiReadingLanguageModelPort,
} from "./application/ports/language-model.port";
import {
  AI_READING_MODEL_CONFIG_PORT,
  type ModelConfigPort as AiReadingModelConfigPort,
} from "./application/ports/model-config.port";
import {
  AI_READING_MODEL_RUNTIME_PORT,
  type ModelRuntimePort,
} from "./application/ports/model-runtime.port";
import {
  AI_READING_BOOK_ANALYSIS_PORT,
  type BookAnalysisPort,
} from "./application/ports/book-analysis.port";
import { AiModelSupportAdapter } from "./infrastructure/ai-model-support.adapter";
import { IntelligentLibraryBookAnalysisAdapter } from "./infrastructure/intelligent-library-book-analysis.adapter";

@Module({
  imports: [SelectionQaModule, AiModelSupportModule, IntelligentLibraryModule, SqlitePersistenceModule, ReaderToolsHttpModule],
  controllers: [AiReadingController],
  providers: [
    ReadingTaskRepository,
    ReadingConversationRepository,
    AgentRunRepository,
    BudgetLedgerRepository,
    EvidenceRepository,
    AiReadingApplicationErrorInterceptor,
    NestTelemetryAdapter,
    {
      provide: AiModelSupportAdapter,
      inject: [
        LANGUAGE_MODEL_GATEWAY,
        MODEL_CONFIG_PORT,
        MODEL_PROFILE_REGISTRY,
        TOKEN_ESTIMATOR_REGISTRY,
      ],
      useFactory: (
        model: LanguageModelPort,
        configs: ModelConfigPort,
        profiles: ModelCapabilityCatalog,
        estimators: TokenEstimatorCatalog,
      ) => new AiModelSupportAdapter(model, configs, profiles, estimators),
    },
    { provide: AI_READING_LANGUAGE_MODEL_PORT, useExisting: AiModelSupportAdapter },
    { provide: AI_READING_MODEL_CONFIG_PORT, useExisting: AiModelSupportAdapter },
    { provide: AI_READING_MODEL_RUNTIME_PORT, useExisting: AiModelSupportAdapter },
    {
      provide: IntelligentLibraryBookAnalysisAdapter,
      inject: [BOOK_READING_PROFILE_ACCESS_PORT],
      useFactory: (analysis: BookReadingProfileAccessPort) => (
        new IntelligentLibraryBookAnalysisAdapter(analysis)
      ),
    },
    { provide: AI_READING_BOOK_ANALYSIS_PORT, useExisting: IntelligentLibraryBookAnalysisAdapter },
    {
      provide: BookContentReadingToolsAdapter,
      inject: [BOOK_CONTENT_ACCESS_PORT, GetBookMetadataUseCase, ListBookAnnotationsUseCase],
      useFactory: (
        bookContent: BookContentAccessPort,
        metadata: GetBookMetadataUseCase,
        annotations: ListBookAnnotationsUseCase,
      ) => new BookContentReadingToolsAdapter(bookContent, metadata, annotations),
    },
    {
      provide: AgentContextWindow,
      inject: [AI_READING_MODEL_RUNTIME_PORT],
      useFactory: (runtime: ModelRuntimePort) => new AgentContextWindow(runtime),
    },
    {
      provide: AiReadingService,
      inject: [
        ReadingTaskRepository,
        AgentRunRepository,
        BudgetLedgerRepository,
        AiReadingScheduler,
      ],
      useFactory: (
        tasks: ReadingTaskRepository,
        agentRuns: AgentRunRepository,
        taskBudgets: BudgetLedgerRepository,
        scheduler: AiReadingScheduler,
      ) => new AiReadingService(
        tasks,
        agentRuns,
        taskBudgets,
        scheduler,
      ),
    },
    {
      provide: ReadingConversationService,
      inject: [
        AI_READING_MODEL_CONFIG_PORT,
        ReadingConversationRepository,
        BookContentReadingToolsAdapter,
        AI_READING_BOOK_ANALYSIS_PORT,
        ReadingTaskRepository,
        EvidenceRepository,
        AI_READING_MODEL_RUNTIME_PORT,
      ],
      useFactory: (
        modelConfigs: AiReadingModelConfigPort,
        conversations: ReadingConversationRepository,
        readingTools: BookContentReadingToolsAdapter,
        bookAnalysis: BookAnalysisPort,
        tasks: ReadingTaskRepository,
        evidence: EvidenceRepository,
        modelRuntime: ModelRuntimePort,
      ) => new ReadingConversationService(
        modelConfigs,
        conversations,
        readingTools,
        bookAnalysis,
        tasks,
        evidence,
        {
          maxActiveTurns: parseIntegerEnv("AI_READING_TURN_CONCURRENCY", 2, 1, 2),
          enabled: process.env.AI_READING_CONVERSATIONS_ENABLED !== "false",
        },
        modelRuntime,
      ),
    },
    {
      provide: ConversationEvidenceImportService,
      inject: [ReadingConversationRepository, EvidenceRepository, BookContentReadingToolsAdapter],
      useFactory: (
        conversations: ReadingConversationRepository,
        evidence: EvidenceRepository,
        readingTools: BookContentReadingToolsAdapter,
      ) => new ConversationEvidenceImportService(conversations, evidence, readingTools),
    },
    {
      provide: AgentRunExecutor,
      inject: [
        AI_READING_LANGUAGE_MODEL_PORT,
        BookContentReadingToolsAdapter,
        ReadingTaskRepository,
        AgentRunRepository,
        BudgetLedgerRepository,
        EvidenceRepository,
        ReadingConversationRepository,
        AI_READING_MODEL_CONFIG_PORT,
        ConversationEvidenceImportService,
        NestTelemetryAdapter,
        AgentContextWindow,
      ],
      useFactory: (
        languageModel: AiReadingLanguageModelPort,
        readingTools: BookContentReadingToolsAdapter,
        tasks: ReadingTaskRepository,
        runs: AgentRunRepository,
        budgets: BudgetLedgerRepository,
        evidence: EvidenceRepository,
        conversations: ReadingConversationRepository,
        modelConfigs: AiReadingModelConfigPort,
        evidenceImporter: ConversationEvidenceImportService,
        telemetry: NestTelemetryAdapter,
        contextWindow: AgentContextWindow,
      ) => new AgentRunExecutor(
        languageModel, readingTools, tasks, runs, budgets, evidence, conversations, modelConfigs,
        evidenceImporter, readingTools,
        { maxDelegationDepth: parseIntegerEnv('AI_READING_MAX_DELEGATION_DEPTH', 2, 1, 2) as 1 | 2 },
        telemetry,
        contextWindow,
      ),
    },
    {
      provide: AiReadingScheduler,
      inject: [AgentRunRepository, AgentRunExecutor],
      useFactory: (runs: AgentRunRepository, executor: AgentRunExecutor) => new AiReadingScheduler(
        runs, executor,
        { maxConcurrentRuns: parseIntegerEnv('AI_READING_AGENT_CONCURRENCY', 4, 1, 4) },
      ),
    },
  ],
})
export class AiReadingModule {}

function parseIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}
