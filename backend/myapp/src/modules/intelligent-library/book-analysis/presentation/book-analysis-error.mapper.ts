import { AppException } from "../../../../platform/http/app-exception";
import { BookAnalysisError } from "../domain/book-analysis.error";

export function throwBookAnalysisHttpError(error: unknown): never {
  if (!(error instanceof BookAnalysisError)) throw error;
  if (error.kind === "VALIDATION") {
    throw AppException.validation(error.field, error.message);
  }
  throw new AppException(
    error.kind === "NOT_FOUND" ? 404 : 409,
    error.kind === "NOT_FOUND" ? 40401 : 40004,
    error.message,
    { field: error.field, reason: error.reason },
  );
}
