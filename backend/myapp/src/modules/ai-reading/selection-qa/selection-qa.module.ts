import { SelectionQaLocationController } from "./presentation/selection-qa-location.controller";
import { SelectionQaLocationService } from "./application/selection-qa-location.service";
import { SelectionQaScheduler } from "./infrastructure/selection-qa.scheduler";
import { SelectionQaExecutor } from "./application/selection-qa.executor";
import {
  SELECTION_QA_MODEL_PORT,
  QaModelPort,
} from "./application/selection-qa-runtime.port";
import { SelectionQaModelAdapter } from "./infrastructure/selection-qa-model.adapter";
import { SelectionQaBooksAdapter } from "./infrastructure/selection-qa-books.adapter";
import { SelectionQaCurrentBookAdapter } from "./infrastructure/selection-qa-current-book.adapter";
import { SqliteSelectionQaRuntimeStore } from "./infrastructure/sqlite-selection-qa-runtime.store";
import { SqliteService } from "../../../platform/persistence/sqlite/sqlite.service";
import {
  AiModelSupportModule,
  LANGUAGE_MODEL_GATEWAY,
  MODEL_CONFIG_PORT,
  MODEL_PROFILE_REGISTRY,
  TOKEN_ESTIMATOR_REGISTRY,
  LanguageModelPort,
  ModelConfigPort,
  ModelCapabilityCatalog,
  TokenEstimatorCatalog,
} from "../../../support/ai-model/public";
import {
  BOOK_RETRIEVAL_PORT,
  BookRetrievalPort,
} from "../../intelligent-library/public/book-retrieval.port";
import { SelectionQaAnnotationAdapter } from "./infrastructure/annotation-application.adapter";
import { ReadingStateModule } from "../../reading-state/reading-state.module";
import {
  ANNOTATION_SELECTION_COMMAND_PORT,
  AnnotationSelectionCommandPort,
} from "../../reading-state/public/annotation-selection-command.port";
import { Module } from "@nestjs/common";
import { SqlitePersistenceModule } from "../../../platform/persistence/sqlite/sqlite-persistence.module";
import {
  BOOK_SELECTION_PORT,
  BookSelectionPort,
} from "../../intelligent-library/public/book-selection.port";
import { IntelligentLibraryModule } from "../../intelligent-library/public";
import { LIBRARY_QUERY_PORT, LibraryQueryPort } from "../../intelligent-library/public/library-query.port";
import { SelectionQaService } from "./application/selection-qa.service";
import { SqliteSelectionQaRepository } from "./infrastructure/sqlite-selection-qa.repository";
import { SelectionQaBookSelectionAdapter } from "./infrastructure/book-selection.adapter";
import { SelectionQaController } from "./presentation/selection-qa.controller";
@Module({
  imports: [
    SqlitePersistenceModule,
    AiModelSupportModule,
    IntelligentLibraryModule,
    ReadingStateModule,
  ],
  controllers: [SelectionQaController, SelectionQaLocationController],
  providers: [
    SqliteSelectionQaRepository,
    {
      provide: SelectionQaLocationService,
      inject: [
        SqliteSelectionQaRepository,
        SelectionQaBookSelectionAdapter,
        SelectionQaBooksAdapter,
      ],
      useFactory: (
        store: SqliteSelectionQaRepository,
        content: SelectionQaBookSelectionAdapter,
        books: SelectionQaBooksAdapter,
      ) => new SelectionQaLocationService(store, content, books),
    },
    {
      provide: SELECTION_QA_MODEL_PORT,
      inject: [
        LANGUAGE_MODEL_GATEWAY,
        MODEL_CONFIG_PORT,
        MODEL_PROFILE_REGISTRY,
        TOKEN_ESTIMATOR_REGISTRY,
      ],
      useFactory: (
        model: LanguageModelPort,
        config: ModelConfigPort,
        profiles: ModelCapabilityCatalog,
        tokens: TokenEstimatorCatalog,
      ) => new SelectionQaModelAdapter(model, config, profiles, tokens),
    },
    {
      provide: SelectionQaCurrentBookAdapter,
      inject: [LIBRARY_QUERY_PORT],
      useFactory: (library: LibraryQueryPort) => new SelectionQaCurrentBookAdapter(library),
    },
    {
      provide: SelectionQaBooksAdapter,
      inject: [BOOK_RETRIEVAL_PORT],
      useFactory: (books: BookRetrievalPort) =>
        new SelectionQaBooksAdapter(books),
    },
    {
      provide: SqliteSelectionQaRuntimeStore,
      inject: [
        SqliteService,
        SqliteSelectionQaRepository,
        SelectionQaBookSelectionAdapter,
      ],
      useFactory: (
        sqlite: SqliteService,
        records: SqliteSelectionQaRepository,
        content: SelectionQaBookSelectionAdapter,
      ) => new SqliteSelectionQaRuntimeStore(sqlite, records, content),
    },
    {
      provide: SelectionQaExecutor,
      inject: [
        SqliteSelectionQaRuntimeStore,
        SELECTION_QA_MODEL_PORT,
        SelectionQaBooksAdapter,
        SelectionQaCurrentBookAdapter,
      ],
      useFactory: (
        store: SqliteSelectionQaRuntimeStore,
        model: QaModelPort,
        books: SelectionQaBooksAdapter,
        currentBook: SelectionQaCurrentBookAdapter,
      ) => new SelectionQaExecutor(store, model, books, currentBook),
    },
    {
      provide: SelectionQaScheduler,
      inject: [SqliteSelectionQaRuntimeStore, SelectionQaExecutor],
      useFactory: (
        store: SqliteSelectionQaRuntimeStore,
        executor: SelectionQaExecutor,
      ) => new SelectionQaScheduler(store, executor),
    },
    {
      provide: SelectionQaBookSelectionAdapter,
      inject: [BOOK_SELECTION_PORT],
      useFactory: (port: BookSelectionPort) =>
        new SelectionQaBookSelectionAdapter(port),
    },
    {
      provide: SelectionQaService,
      inject: [
        SqliteSelectionQaRepository,
        SelectionQaBookSelectionAdapter,
        ANNOTATION_SELECTION_COMMAND_PORT,
        SELECTION_QA_MODEL_PORT,
      ],
      useFactory: (
        store: SqliteSelectionQaRepository,
        content: SelectionQaBookSelectionAdapter,
        annotations: AnnotationSelectionCommandPort,
        model: QaModelPort,
      ) =>
        new SelectionQaService(
          store,
          content,
          new SelectionQaAnnotationAdapter(annotations),
          model,
        ),
    },
  ],
})
export class SelectionQaModule {}
