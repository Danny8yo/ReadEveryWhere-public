import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, catchError } from "rxjs";
import { AppException } from "../../../platform/http/app-exception";
import { AiReadingApplicationError } from "../application/application-error";

const HTTP_ERROR_BY_KIND = {
  not_found: { status: 404, code: 40401 },
  validation: { status: 400, code: 40002 },
  invalid_state: { status: 409, code: 40004 },
  conflict: { status: 409, code: 40004 },
  disabled: { status: 404, code: 40401 },
  unsupported_model: { status: 400, code: 40002 },
} as const;

@Injectable()
export class AiReadingApplicationErrorInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof AiReadingApplicationError) {
          const mapping = HTTP_ERROR_BY_KIND[error.kind];
          throw new AppException(mapping.status, mapping.code, error.message, error.details);
        }
        throw error;
      }),
    );
  }
}
