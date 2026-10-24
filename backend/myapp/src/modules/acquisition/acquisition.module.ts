import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { CryptoModule } from "../../platform/crypto/crypto.module";
import { StorageModule } from "../../platform/storage/storage.module";
import { SqlitePersistenceModule } from "../../platform/persistence/sqlite/sqlite-persistence.module";
import {
  ATTACH_BOOK_FILE_PORT,
  BOOK_FILE_STATUS_QUERY_PORT,
  BOOK_OWNERSHIP_PORT,
  BOOK_SOURCE_REFERENCE_QUERY_PORT,
  IntelligentLibraryModule,
  type AttachBookFilePort,
  type BookFileStatusQueryPort,
  type BookOwnershipPort,
  type BookSourceReferenceQueryPort,
} from "../intelligent-library/public";
import { DownloadService } from "./download/application/download.service";
import {
  DOWNLOAD_TASK_REPOSITORY_PORT,
  type DownloadTaskRepositoryPort,
} from "./download/application/ports/download-task-repository.port";
import { CancelDownloadTaskUseCase } from "./download/application/use-cases/cancel-download-task.use-case";
import { CreateDownloadTaskUseCase } from "./download/application/use-cases/create-download-task.use-case";
import { GetDownloadTaskUseCase } from "./download/application/use-cases/get-download-task.use-case";
import { SqliteDownloadTaskRepository } from "./download/infrastructure/sqlite-download-task.repository";
import { DownloadController } from "./download/presentation/http/download.controller";
import {
  SOURCE_SETTINGS_QUERY_PORT,
  type SourceSettingsQueryPort,
} from "./public/source-settings-query.port";
import { SearchService } from "./search/application/search.service";
import { SEARCH_CACHE_PORT, type SearchCachePort } from "./search/application/ports/search-cache.port";
import { SqliteSearchCacheRepository } from "./search/infrastructure/sqlite-search-cache.repository";
import { SearchController } from "./search/presentation/http/search.controller";
import { SourceRegistry } from "./source-registry/application/source-registry";
import { SOURCE_SETTINGS_STORE_PORT } from "./source-settings/application/ports/source-settings-store.port";
import { SourceSettingsQueryService } from "./source-settings/application/source-settings-query.service";
import { UserZlibraryConfigService } from "./source-settings/application/user-zlibrary-config.service";
import { UserZlibraryConfigRepository } from "./source-settings/infrastructure/user-zlibrary-config.repository";
import { UserZlibraryConfigController } from "./source-settings/presentation/http/user-zlibrary-config.controller";
import { safeOutboundHttpConfig } from "../../platform/security/safe-outbound-http";

@Module({
  imports: [
    SqlitePersistenceModule,
    StorageModule,
    HttpModule.register(safeOutboundHttpConfig()),
    CryptoModule,
    IntelligentLibraryModule,
  ],
  controllers: [SearchController, DownloadController, UserZlibraryConfigController],
  providers: [
    UserZlibraryConfigRepository,
    { provide: SOURCE_SETTINGS_STORE_PORT, useExisting: UserZlibraryConfigRepository },
    {
      provide: SourceSettingsQueryService,
      inject: [SOURCE_SETTINGS_STORE_PORT],
      useFactory: (store: UserZlibraryConfigRepository) => new SourceSettingsQueryService(
        store,
        process.env.ZLIB_BASE_URL ?? "https://zlibrary-mirror.example.com",
      ),
    },
    { provide: SOURCE_SETTINGS_QUERY_PORT, useExisting: SourceSettingsQueryService },
    // ⚠️ 脱敏说明（公开版本）
    // 这里原本装配外部数据源（Z-Library）的三个 Provider：
    //   ZlibraryAuthService     —— 上游登录 / 凭据换取，凭据经 CryptoService 加密后落库
    //   ZlibrarySearchProvider  —— 实现 SourceAdapterPort 的检索侧
    //   ZlibraryDownloadProvider—— 实现 SourceAdapterPort 的下载侧
    // 它们的实现（含具体上游地址、接口参数与认证流程）已整体移除。
    //
    // TODO(自行实现)：提供实现 `./public/source-adapter.port` 的 Search / Download Provider，
    // 然后在下面把它们注入 SourceRegistry：
    //   { provide: SourceRegistry,
    //     inject: [YourSearchProvider, YourDownloadProvider],
    //     useFactory: (search, download) => new SourceRegistry([search], [download]) }
    // 当前用空注册表占位：SearchService / DownloadService 的编排逻辑、缓存、任务状态机
    // 全部保留且可读，只是没有可用的上游。
    {
      provide: SourceRegistry,
      useFactory: () => new SourceRegistry([], []),
    },
    SqliteSearchCacheRepository,
    { provide: SEARCH_CACHE_PORT, useExisting: SqliteSearchCacheRepository },
    {
      provide: SearchService,
      inject: [SEARCH_CACHE_PORT, SourceRegistry, SOURCE_SETTINGS_QUERY_PORT],
      useFactory: (
        cache: SearchCachePort,
        sources: SourceRegistry,
        settings: SourceSettingsQueryPort,
      ) => new SearchService(
        cache,
        sources,
        settings,
        parseSearchCacheTtl(),
      ),
    },
    SqliteDownloadTaskRepository,
    { provide: DOWNLOAD_TASK_REPOSITORY_PORT, useExisting: SqliteDownloadTaskRepository },
    {
      provide: DownloadService,
      inject: [
        DOWNLOAD_TASK_REPOSITORY_PORT,
        SourceRegistry,
        BOOK_OWNERSHIP_PORT,
        BOOK_SOURCE_REFERENCE_QUERY_PORT,
        BOOK_FILE_STATUS_QUERY_PORT,
        ATTACH_BOOK_FILE_PORT,
      ],
      useFactory: (
        tasks: DownloadTaskRepositoryPort,
        sources: SourceRegistry,
        ownership: BookOwnershipPort,
        sourceReferences: BookSourceReferenceQueryPort,
        files: BookFileStatusQueryPort,
        fileDelivery: AttachBookFilePort,
      ) => new DownloadService(
        tasks,
        sources,
        ownership,
        sourceReferences,
        files,
        fileDelivery,
      ),
    },
    {
      provide: CreateDownloadTaskUseCase,
      inject: [DownloadService],
      useFactory: (service: DownloadService) => new CreateDownloadTaskUseCase(service),
    },
    {
      provide: GetDownloadTaskUseCase,
      inject: [DownloadService],
      useFactory: (service: DownloadService) => new GetDownloadTaskUseCase(service),
    },
    {
      provide: CancelDownloadTaskUseCase,
      inject: [DownloadService],
      useFactory: (service: DownloadService) => new CancelDownloadTaskUseCase(service),
    },
    // TODO(自行实现): UserZlibraryConfigService 依赖上游登录服务（原 ZlibraryAuthService，
    // 实现 SourceLoginPort）。该实现已随外部数据源一并移除，故此处不再注册。
    // 用户凭据的加密存储（UserZlibraryConfigRepository）与 HTTP 契约
    // （UserZlibraryConfigController）均原样保留，补上一个 SourceLoginPort 实现即可恢复：
    //   { provide: UserZlibraryConfigService,
    //     inject: [YourSourceLoginService, SOURCE_SETTINGS_STORE_PORT],
    //     useFactory: (login, store) =>
    //       new UserZlibraryConfigService(login, store, process.env.ZLIB_BASE_URL ?? null) }
  ],
  exports: [SOURCE_SETTINGS_QUERY_PORT],
})
export class AcquisitionModule {}

function parseSearchCacheTtl(): number {
  const hours = Number.parseInt(process.env.SEARCH_CACHE_TTL_HOURS ?? "6", 10);
  return hours * 60 * 60 * 1000;
}
