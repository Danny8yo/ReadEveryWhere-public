export type BookAnalysisErrorKind = "VALIDATION" | "NOT_FOUND" | "INVALID_STATE";

export class BookAnalysisError extends Error {
  constructor(
    public readonly kind: BookAnalysisErrorKind,
    public readonly reason: string,
    message: string,
    public readonly field: string | null,
  ) {
    super(message);
  }

  static validation(field: string | null, message: string): BookAnalysisError {
    return new BookAnalysisError("VALIDATION", "VALIDATION_ERROR", message, field);
  }

  static rejected(reason: string, message: string): BookAnalysisError {
    return new BookAnalysisError(
      reason === "BOOK_NOT_FOUND" || reason === "BOOK_ANALYSIS_CANDIDATE_NOT_FOUND"
        ? "NOT_FOUND"
        : "INVALID_STATE",
      reason,
      message,
      "bookId",
    );
  }
}
