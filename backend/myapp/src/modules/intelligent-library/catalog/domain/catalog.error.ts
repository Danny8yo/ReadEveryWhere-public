export type CatalogErrorKind =
  | "VALIDATION"
  | "CONFLICT"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "INTERNAL";

export class CatalogError extends Error {
  constructor(
    public readonly kind: CatalogErrorKind,
    message: string,
    public readonly field: string | null = null,
    public readonly existingBookId?: number,
  ) {
    super(message);
  }

  static validation(field: string | null, message: string): CatalogError {
    return new CatalogError("VALIDATION", message, field);
  }

  static conflict(field: string | null, message: string, existingBookId?: number): CatalogError {
    return new CatalogError("CONFLICT", message, field, existingBookId);
  }

  static notFound(field: string | null, message: string): CatalogError {
    return new CatalogError("NOT_FOUND", message, field);
  }

  static unauthorized(message: string): CatalogError {
    return new CatalogError("UNAUTHORIZED", message);
  }

  static internal(message = "Internal server error"): CatalogError {
    return new CatalogError("INTERNAL", message);
  }
}
