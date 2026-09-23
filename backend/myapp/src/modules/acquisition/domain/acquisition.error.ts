export type AcquisitionErrorKind = "VALIDATION" | "NOT_FOUND" | "UPSTREAM" | "INTERNAL";

export class AcquisitionError extends Error {
  constructor(
    public readonly kind: AcquisitionErrorKind,
    message: string,
    public readonly field: string | null = null,
  ) {
    super(message);
  }

  static validation(field: string, message: string): AcquisitionError {
    return new AcquisitionError("VALIDATION", message, field);
  }

  static notFound(field: string, message: string): AcquisitionError {
    return new AcquisitionError("NOT_FOUND", message, field);
  }

  static upstream(message: string): AcquisitionError {
    return new AcquisitionError("UPSTREAM", message);
  }

  static internal(message: string): AcquisitionError {
    return new AcquisitionError("INTERNAL", message);
  }
}
