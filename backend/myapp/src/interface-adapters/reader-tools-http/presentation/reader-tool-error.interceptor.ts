import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, catchError } from "rxjs";
import { AppException } from "../../../platform/http/app-exception";
import { ReaderToolException } from "../../../modules/intelligent-library/public/reader-tool-error";

@Injectable()
export class ReaderToolErrorInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof ReaderToolException) {
          throw new AppException(
            error.status,
            error.code,
            error.message,
            error.details,
          );
        }
        throw error;
      }),
    );
  }
}
