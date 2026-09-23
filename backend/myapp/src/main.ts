import "reflect-metadata";
import { configureSelectionQaHttp } from "./modules/ai-reading/selection-qa/presentation/configure-selection-qa-http";

import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

// 生产环境校验：确保 NODE_ENV 已正确设置
if (process.env.NODE_ENV === "production") {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "read-everywhere-dev-secret") {
    throw new Error("JWT_SECRET must be set to a secure random value in production");
  }
  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be 64 hex characters (32 bytes) in production");
  }
}

import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { NativeLogger } from "nestjs-pino";
import { AllExceptionsFilter } from "./platform/http/all-exceptions.filter";
import { SuccessResponseInterceptor } from "./platform/http/success-response.interceptor";

/**
 * 应用启动入口：注册全局中间件、校验管道、异常过滤器、成功响应拦截器，并开启 CORS 与端口监听。
 */
async function bootstrap(): Promise<void> {
  // 动态导入 AppModule，确保在 dotenv 加载 .env 后再触发模块链
  const { AppModule } = await import("./app.module");

  // 初始化 Nest 应用实例。
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureSelectionQaHttp(app);
  app.useLogger(app.get(NativeLogger));
  const logger = new Logger("Bootstrap");

  // 部署在反向代理(Nginx/Caddy)+CDN 之后：信任一层代理传来的 X-Forwarded-For，
  // 使限流按真实客户端 IP 而非反代回环地址计数（配合 ThrottlerModule 的 getTracker）。
  // 注意：反代需正确设置 X-Forwarded-For；信任层数应与实际代理链一致。
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  app.use(helmet());

  // 统一参数校验与转换策略：自动类型转换、剔除白名单外字段、遇到未知字段直接报错。
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new SuccessResponseInterceptor());

  const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";
  const origins = corsOrigin.split(",").map((item) => item.trim()).filter(Boolean);
  app.enableCors({
    origin: origins,
    credentials: true,
  });

  // 端口可通过环境变量覆盖，未配置时默认使用 3000。
  const port = Number(process.env.PORT ?? 3000);
  const listenHost = process.env.LISTEN_HOST ?? "0.0.0.0";
  await app.listen(port, listenHost);
  logger.log({
    event: "app.started",
    port,
    listenHost,
    nodeEnv: process.env.NODE_ENV ?? "development",
    logLevel: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  });
}

bootstrap();
