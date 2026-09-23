export type AiReadingApplicationErrorKind =
  | "not_found"
  | "validation"
  | "invalid_state"
  | "conflict"
  | "disabled"
  | "unsupported_model";

export class AiReadingApplicationError extends Error {
  constructor(
    readonly kind: AiReadingApplicationErrorKind,
    message: string,
    readonly details: { field: string | null; reason: string },
  ) {
    super(message);
    this.name = "AiReadingApplicationError";
  }
}
