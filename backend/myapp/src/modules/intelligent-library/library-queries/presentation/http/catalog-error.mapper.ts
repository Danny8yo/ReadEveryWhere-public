import { AppException } from "../../../../../platform/http/app-exception";
import { CatalogError } from "../../../catalog/domain/catalog.error";

export function toCatalogHttpError(error: CatalogError): AppException {
  switch (error.kind) {
    case "VALIDATION":
      return AppException.validation(error.field, error.message);
    case "CONFLICT":
      return error.existingBookId === undefined
        ? AppException.conflict(error.field, error.message)
        : AppException.conflictWithExisting(error.field, error.existingBookId, error.message);
    case "NOT_FOUND":
      return AppException.notFound(error.field, error.message);
    case "UNAUTHORIZED":
      return AppException.unauthorized(error.message);
    case "INTERNAL":
      return AppException.internal(error.message);
  }
}

export function throwCatalogHttpError(error: unknown): never {
  if (error instanceof CatalogError) throw toCatalogHttpError(error);
  throw error;
}
