import type { ContentScope, ResolvedSelection } from "@readeverywhere/epub-core/types";
import type { BookSelectionRequest } from "../../../public/book-selection.port";
export interface EpubSelectionResolverPort {
  resolve(bytes: Buffer, scope: ContentScope, request: BookSelectionRequest): Promise<ResolvedSelection>;
}
export const EPUB_SELECTION_RESOLVER_PORT = Symbol("EPUB_SELECTION_RESOLVER_PORT");
