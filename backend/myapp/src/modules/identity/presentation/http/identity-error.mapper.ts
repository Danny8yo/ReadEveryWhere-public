import { AppException } from "../../../../platform/http/app-exception";
import { IdentityApplicationError } from "../../application/identity-application.error";

export function toIdentityHttpError(error: unknown): unknown {
  if (!(error instanceof IdentityApplicationError)) return error;

  switch (error.kind) {
    case "validation":
      return AppException.validation(error.field, error.message);
    case "conflict":
      return AppException.conflict(error.field, error.message);
    case "unauthorized":
      return AppException.unauthorized(error.message);
    case "forbidden":
      return AppException.forbidden(error.message);
    case "not_found":
      return AppException.notFound(error.field, error.message);
    case "rate_limited":
      return new AppException(429, 42901, error.message, {
        reason: "LOGIN_TEMPORARILY_LOCKED",
        recovery: { retryAfterSeconds: error.retryAfterSeconds },
      });
  }
}

export function throwIdentityHttpError(error: unknown): never {
  throw toIdentityHttpError(error);
}
