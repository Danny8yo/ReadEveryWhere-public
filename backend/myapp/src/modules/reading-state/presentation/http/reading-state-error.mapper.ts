import { AppException } from "../../../../platform/http/app-exception";
import { ReadingStateError } from "../../domain/reading-state.error";

export function throwReadingStateHttpError(error: unknown): never {
  if (!(error instanceof ReadingStateError)) throw error;

  switch (error.code) {
    case "BOOK_NOT_FOUND":
      throw AppException.notFound("book", error.message);
    case "ANNOTATION_NOT_FOUND":
      throw AppException.notFound("annotation", error.message);
    case "BOOKMARK_NOT_FOUND":
      throw AppException.notFound("bookmark", error.message);
    case "ANNOTATION_COMMAND_CONFLICT":
    case "ANNOTATION_SELECTION_INVALID":
      throw new AppException(409, 40003, error.message, { field: "annotation", reason: error.code, current: error.current });
    case "ANNOTATION_CONFLICT":
      throw AppException.revisionConflict("annotation", error.message, error.current);
    case "READING_STATE_INTERNAL":
      throw AppException.internal(error.message);
  }
}
