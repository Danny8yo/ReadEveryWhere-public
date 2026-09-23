import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { AppException } from "./app-exception";
import { SqliteBusyError } from "../persistence/sqlite/sqlite-retry";

/**
 * 全局异常过滤器：将不同异常统一输出为约定响应结构。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const requestId = request.requestId ?? randomUUID();
    response.setHeader("x-request-id", requestId);

    const timestamp = new Date().toISOString();

    if (exception instanceof SqliteBusyError) {
      response.setHeader("Retry-After", String(exception.retryAfterSeconds));
      response.status(503).json({
        code: 50301,
        message: "Database is busy, retry shortly",
        details: { reason: "DATABASE_BUSY", retryAfterSeconds: exception.retryAfterSeconds },
        requestId,
        timestamp,
      });
      return;
    }

    // 业务异常：直接透传已规范化的 code/message/details。
    if (exception instanceof AppException) {
      // 客户端错误（4xx）是正常业务流，HTTP 完成日志已记一条；这里降到 debug 只留排障明细，
      // 避免生产里同一次请求打两条 warn。服务端错误（5xx）仍 warn。
      const appLog = {
        event: "exception.app",
        requestId,
        method: request.method,
        url: request.originalUrl,
        userId: request.user?.userId ?? null,
        statusCode: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details ?? null,
      };
      if (exception.status >= 500) this.logger.warn(appLog);
      else this.logger.debug(appLog);
      response.status(exception.status).json({
        code: exception.code,
        message: exception.message,
        details: exception.details ?? null,
        requestId,
        timestamp,
      });
      return;
    }

    // DTO 校验 / 文件校验错误：转换为统一参数校验失败响应。
    if (exception instanceof BadRequestException) {
      const payload = exception.getResponse() as { message?: string[] | string };
      // 参数校验失败恒为 4xx 客户端错误，降到 debug（HTTP 完成日志已含 400）。
      this.logger.debug({
        event: "exception.validation",
        requestId,
        method: request.method,
        url: request.originalUrl,
        userId: request.user?.userId ?? null,
        message: payload?.message ?? exception.message,
      });
      if (Array.isArray(payload?.message)) {
        response.status(HttpStatus.BAD_REQUEST).json({
          code: 40002,
          message: "Parameter validation failed",
          details: { field: String(payload.message[0]).split(" ")[0], reason: "VALIDATION_ERROR" },
          requestId,
          timestamp,
        });
      } else {
        response.status(HttpStatus.BAD_REQUEST).json({
          code: 40002,
          message: payload?.message || exception.message,
          details: null,
          requestId,
          timestamp,
        });
      }
      return;
    }

    // 其他 HttpException：保留 HTTP 状态并统一业务错误码。
    if (exception instanceof HttpException) {
      const httpLog = {
        event: "exception.http",
        requestId,
        method: request.method,
        url: request.originalUrl,
        userId: request.user?.userId ?? null,
        statusCode: exception.getStatus(),
        message: exception.message,
      };
      if (exception.getStatus() >= 500) this.logger.warn(httpLog);
      else this.logger.debug(httpLog);
      const message = process.env.NODE_ENV === 'production'
        ? "An error occurred"
        : exception.message;
      response.status(exception.getStatus()).json({
        code: 50001,
        message,
        details: {
          reason: "HTTP_EXCEPTION",
        },
        requestId,
        timestamp,
      });
      return;
    }

    // 未知异常兜底。
    const error = exception instanceof Error ? exception : null;
    this.logger.error({
      event: "exception.unhandled",
      requestId,
      method: request.method,
      url: request.originalUrl,
      userId: request.user?.userId ?? null,
      errorName: error?.name ?? typeof exception,
      message: error?.message ?? String(exception),
      stack: error?.stack,
    });
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 50001,
      message: "Internal server error",
      details: {
        reason: "INTERNAL_ERROR",
      },
      requestId,
      timestamp,
    });
  }
}
