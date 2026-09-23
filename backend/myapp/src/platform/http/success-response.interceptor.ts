import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";

/**
 * 全局成功响应拦截器：统一封装成功返回体。
 */
@Injectable()
export class SuccessResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const requestId = request.requestId;

    return next.handle().pipe(
      map((data) => ({
        code: 0,
        message: "success",
        data,
        requestId,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
