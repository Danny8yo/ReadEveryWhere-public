export type ReadingStateErrorCode =
  | "BOOK_NOT_FOUND"
  | "ANNOTATION_NOT_FOUND"
  | "BOOKMARK_NOT_FOUND"
  | "ANNOTATION_CONFLICT"
  | "ANNOTATION_COMMAND_CONFLICT"
  | "ANNOTATION_SELECTION_INVALID"
  | "READING_STATE_INTERNAL";

export class ReadingStateError extends Error {
  constructor(
    public readonly code: ReadingStateErrorCode,
    message: string,
    public readonly current?: unknown,
  ) {
    super(message);
  }

  static bookNotFound(): ReadingStateError {
    return new ReadingStateError("BOOK_NOT_FOUND", "Book not found");
  }

  static bookmarkNotFound(): ReadingStateError {
    return new ReadingStateError("BOOKMARK_NOT_FOUND", "Bookmark not found");
  }

  static annotationNotFound(): ReadingStateError {
    return new ReadingStateError("ANNOTATION_NOT_FOUND", "Annotation not found");
  }

  static annotationConflict(current: unknown): ReadingStateError {
    return new ReadingStateError(
      "ANNOTATION_CONFLICT",
      "Annotation was changed on another device",
      current,
    );
  }

  static internal(): ReadingStateError {
    return new ReadingStateError("READING_STATE_INTERNAL", "Internal server error");
  }
}
