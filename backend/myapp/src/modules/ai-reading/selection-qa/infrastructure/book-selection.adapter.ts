import { validateSelectionRequest } from "../application/selection-request.validation";
import {
  BookSelectionPort,
  BookSelectionRequest,
} from "../../../intelligent-library/public/book-selection.port";
import { ReaderToolException } from "../../../intelligent-library/public";
import {
  SelectionQaContentPort,
  SelectionQaError,
  SelectionSnapshot,
} from "../application/selection-qa.types";
export class SelectionQaBookSelectionAdapter implements SelectionQaContentPort {
  constructor(private readonly selections: BookSelectionPort) {}
  resolve(userId: number, bookId: number, selection: unknown) {
    const request = validateSelectionRequest(selection, bookId);
    return this.selections.resolveSelection(userId, request);
  }
  assertCurrent(userId: number, selection: SelectionSnapshot): void {
    try {
      this.selections.assertCurrent(userId, selection);
    } catch (error) {
      if (
        error instanceof ReaderToolException &&
        error.details?.reason === "CONTENT_REVISION_MISMATCH"
      )
        throw new SelectionQaError("CONTENT_VERSION_CHANGED");
      throw error;
    }
  }
}
