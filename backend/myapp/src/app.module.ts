import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { IdentityModule } from "./modules/identity/public";
import { createPinoHttpOptions } from "./platform/logging/logger.config";
import { HealthController } from "./platform/health/health.controller";
import {
  AI_METADATA_SOURCE_PORT,
  METADATA_SOURCE_PORTS,
  IntelligentLibraryModule,
  type MetadataSourcePort,
} from "./modules/intelligent-library/public";
import { AcquisitionModule } from "./modules/acquisition/public";
import { ReadingStateModule } from "./modules/reading-state/reading-state.module";
import { SelectionQaModule } from "./modules/ai-reading/selection-qa/selection-qa.module";
import { ReaderToolsHttpModule } from "./interface-adapters/reader-tools-http/reader-tools-http.module";
import { MetadataIntegrationsModule } from "./integrations/metadata-integrations.module";
import { DeepSeekIntegrationModule } from "./integrations/deepseek/public";
import { DashScopeIntegrationModule } from "./integrations/dashscope/public";
import { AiModelSupportModule } from "./support/ai-model/public";

@Global()
@Module({
  imports: [MetadataIntegrationsModule, IntelligentLibraryModule],
  providers: [
    {
      provide: METADATA_SOURCE_PORTS,
      inject: [AI_METADATA_SOURCE_PORT],
      useFactory: (ai: MetadataSourcePort): readonly MetadataSourcePort[] => [ai],
    },
  ],
  exports: [METADATA_SOURCE_PORTS],
})
class MetadataIntegrationBindingsModule {}

/**
 * 根模块：加载全局配置并组合业务模块。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      // 全局启用配置模块，优先读取 .env.local，其次 .env。
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),
    LoggerModule.forRoot({
      pinoHttp: createPinoHttpOptions(),
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 100 }],
      // 部署在反代 + CDN 之后：已登录请求按 userId 计数（每人独立限流桶），
      // 未登录端点回退按真实客户端 IP（依赖 main.ts 的 trust proxy 还原 X-Forwarded-For）。
      // 否则所有用户在后端看来都来自反代的回环地址，会共享同一个限流桶、互相 429。
      // userId 取自 SessionAuthGuard 验证后写入的 req.user，攻击者无法伪造绕过。
      getTracker: (req: Record<string, any>) =>
        req.user?.userId ? `user:${req.user.userId}` : `ip:${req.ip}`,
    }),
    DeepSeekIntegrationModule,
    DashScopeIntegrationModule,
    AiModelSupportModule,
    IdentityModule,
    MetadataIntegrationBindingsModule,
    IntelligentLibraryModule,
    SelectionQaModule,
    AcquisitionModule,
    ReadingStateModule,
    ReaderToolsHttpModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
