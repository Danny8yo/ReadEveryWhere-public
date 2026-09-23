export type IdentityApplicationErrorKind =
  | "validation"
  | "conflict"
  | "unauthorized"
  | "forbidden"
  | "not_found";

export class IdentityApplicationError extends Error {
  constructor(
    public readonly kind: IdentityApplicationErrorKind,
    message: string,
    public readonly field: string | null = null,
  ) {
    super(message);
    this.name = "IdentityApplicationError";
  }

  static validation(field: string | null, message: string): IdentityApplicationError {
    return new IdentityApplicationError("validation", message, field);
  }

  static conflict(field: string | null, message: string): IdentityApplicationError {
    return new IdentityApplicationError("conflict", message, field);
  }

  static unauthorized(message: string): IdentityApplicationError {
    return new IdentityApplicationError("unauthorized", message);
  }

  static forbidden(message: string): IdentityApplicationError {
    return new IdentityApplicationError("forbidden", message);
  }

  static notFound(field: string | null, message: string): IdentityApplicationError {
    return new IdentityApplicationError("not_found", message, field);
  }
}
