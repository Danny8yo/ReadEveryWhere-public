import type { Request, Response } from "express";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DestinationStream } from "pino";
import type { Options } from "pino-http";
import { randomUUID } from "node:crypto";

const shouldPrettyPrint = (): boolean => {
  if (process.env.LOG_PRETTY) {
    return process.env.LOG_PRETTY === "true";
  }
  return process.env.NODE_ENV !== "production";
};

const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-api-key']",
  "res.headers['set-cookie']",
  "body.password",
  "body.currentPassword",
  "body.newPassword",
  "body.confirmPassword",
  "body.refreshToken",
  "body.accessToken",
  "body.apiKey",
  "body.remixUserid",
  "body.remixUserkey",
  "*.password",
  "*.currentPassword",
  "*.newPassword",
  "*.confirmPassword",
  "*.refreshToken",
  "*.accessToken",
  "*.apiKey",
  "*.remixUserid",
  "*.remixUserkey",
  "*.remix_userid",
  "*.remix_userkey",
  "*.authorization",
  "*.Authorization",
  "*.reasoning_content",
  "*.reasoningContent",
  "*.systemPrompt",
  "*.token",
  "*.cookie",
  "*.Cookie",
  "msg.details.upstream.reason",
  "details.upstream.reason",
  "*.DOUBAN_COOKIE",
  "*.ZLIB_PASSWORD",
  "*.JWT_SECRET",
  "*.ENCRYPTION_KEY",
];

const sanitizeUrl = (url: string | undefined): string | undefined => {
  if (!url) return url;
  return url.replace(/([?&]token=)[^&]+/gi, "$1[Redacted]");
};

const sanitizeQuery = (query: Request["query"]): Record<string, unknown> => {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query ?? {})) {
    sanitized[key] = key.toLowerCase().includes("token") ? "[Redacted]" : value;
  }
  return sanitized;
};

const asExpressRequest = (req: IncomingMessage): Request => req as Request;
const asExpressResponse = (res: ServerResponse): Response => res as Response;

// HTTP 请求生命周期的固定消息，不重复渲染到业务文本里（method+status+耗时已足够）。
const HTTP_LIFECYCLE_MESSAGES = new Set([
  "request.completed",
  "request.failed",
  "request.started",
]);

/**
 * 开发态紧凑单行渲染。用函数式 messageFormat（需以「进程内 stream」方式挂载 pino-pretty，
 * 而非 worker transport——后者无法传函数），一次覆盖三类日志且无空行、无 [object Object]：
 *   HTTP 请求    → "GET /api/v1/library/books 200 11ms user:1"
 *   框架/字符串  → "[RouterExplorer] Mapped {/api/v1/health, GET} route"
 *   业务事件对象 → "[AuthService] auth.refresh.succeeded user:1 {结构化明细}"
 * 说明：本项目业务日志以对象 { event, ... } 记录，nestjs-pino 会把它挂到 msg 之下，
 * 故 msg 为对象时取 msg.event 作为可读事件名；msg 为字符串时直接用。
 */
const createPrettyStream = (): DestinationStream => {
  // 惰性 require：pino-pretty 是 devDependency，仅开发/pretty 分支用到。
  // 生产镜像 `npm ci --omit=dev` 会裁掉它，绝不能在模块顶层静态 import，否则生产启动即崩。
  const pretty = require("pino-pretty") as (opts: unknown) => DestinationStream;
  return pretty({
    colorize: true,
    singleLine: true,
    translateTime: "SYS:standard",
    // 隐藏已被 messageFormat 收编的顶层字段，避免同一信息重复刷屏。
    ignore: "pid,hostname,req,res,responseTime,requestId,userId,context,reqId",
    messageFormat: (log: Record<string, any>, messageKey: string): string => {
      const parts: string[] = [];
      const req = log.req as { method?: string; url?: string } | undefined;
      const res = log.res as { statusCode?: number } | undefined;
      if (req?.method) parts.push(`${req.method} ${req.url ?? ""}`);
      if (res?.statusCode != null) parts.push(String(res.statusCode));
      if (log.responseTime != null) parts.push(`${log.responseTime}ms`);
      if (log.context) parts.push(`[${log.context}]`);
      const raw = log[messageKey];
      const text =
        typeof raw === "string"
          ? raw
          : raw && typeof raw.event === "string"
            ? raw.event
            : "";
      if (text && !HTTP_LIFECYCLE_MESSAGES.has(text)) parts.push(text);
      if (log.userId != null) parts.push(`user:${log.userId}`);
      return parts.join(" ");
    },
  });
};

const baseOptions = (): Options => ({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: {
    paths: redactPaths,
    censor: "[Redacted]",
  },
  genReqId: (req, res) => {
    const expressReq = asExpressRequest(req);
    const expressRes = asExpressResponse(res);
    const fromHeader = req.headers["x-request-id"];
    const requestId = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
    const resolved = requestId && requestId.trim() ? requestId : randomUUID();
    expressReq.requestId = resolved;
    expressRes.setHeader("x-request-id", resolved);
    return resolved;
  },
  serializers: {
    // 只保留排障必需字段：method + url（脱敏）。默认不再输出 headers/params/id——
    // 那是终端刷屏的主因，且因请求作用域 logger 会被业务日志一并带上。
    req(req) {
      const expressReq = asExpressRequest(req);
      const serialized: Record<string, unknown> = {
        method: req.method,
        url: sanitizeUrl(req.url),
      };
      const query = sanitizeQuery(expressReq.query);
      if (Object.keys(query).length > 0) {
        serialized.query = query;
      }
      // 生产环境保留来源 IP 便于安全溯源；开发环境省略以求简洁。
      if (process.env.NODE_ENV === "production") {
        serialized.remoteAddress =
          expressReq.ip ?? req.remoteAddress ?? req.socket?.remoteAddress ?? null;
      }
      return serialized;
    },
    res(res) {
      return {
        statusCode: res.statusCode,
      };
    },
  },
  customProps: (req) => ({
    requestId: asExpressRequest(req).requestId,
    userId: asExpressRequest(req).user?.userId ?? null,
  }),
  // 不设 customReceivedMessage：只在响应完成时打一条，去掉重复的 "request.started"。
  customSuccessMessage: () => "request.completed",
  customErrorMessage: () => "request.failed",
  customLogLevel: (req, res, error) => {
    if (error || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    // 高频轮询降噪：下载任务状态每 2s 轮询一次，成功时压到 debug
    // （生产默认 info，不落盘；开发 debug 仍可见）。
    const url = req.url ?? "";
    if (req.method === "GET" && /^\/api\/v1\/downloads\/tasks\/[^/]+/.test(url)) {
      return "debug";
    }
    return "info";
  },
});

/**
 * 返回 nestjs-pino 的 pinoHttp 参数。
 * - 开发（pretty）：返回 [options, stream]，用进程内 pino-pretty 流以支持函数式 messageFormat。
 * - 生产：返回纯 options，日志以结构化 JSON 打到 stdout（交给 Docker/日志系统收集）。
 */
export const createPinoHttpOptions = (): Options | [Options, DestinationStream] => {
  const options = baseOptions();
  return shouldPrettyPrint() ? [options, createPrettyStream()] : options;
};
