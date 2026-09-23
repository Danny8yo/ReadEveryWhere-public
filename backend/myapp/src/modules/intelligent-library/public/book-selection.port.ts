import type { ContentScope, ResolvedSelection, SelectionRequest } from "@readeverywhere/epub-core/types";
import type { CurrentBookArtifactIdentity } from "./current-book-artifact-fence.port";
export type BookSelectionRequest = SelectionRequest | { scope: ContentScope; cfi: string; displayedQuote: string; source?: never };
export interface VerifiedBookSelection extends ResolvedSelection { artifact: CurrentBookArtifactIdentity }
export const BOOK_SELECTION_PORT = Symbol("BOOK_SELECTION_PORT");
export interface BookSelectionPort {
  /** displayedQuote is Range.toString(), not the reader's trimmed selection label. */
  resolveSelection(userId: number, request: BookSelectionRequest): Promise<VerifiedBookSelection>;
  assertCurrent(userId: number, selection: VerifiedBookSelection): void;
}
