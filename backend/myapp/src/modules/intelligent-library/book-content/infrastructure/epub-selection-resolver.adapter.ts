import { resolveEpubSelection } from "@readeverywhere/epub-core/node";
import type { EpubSelectionResolverPort } from "../application/ports/epub-selection-resolver.port";
export class EpubSelectionResolverAdapter implements EpubSelectionResolverPort {
  resolve(...args: Parameters<EpubSelectionResolverPort["resolve"]>) { return resolveEpubSelection(...args); }
}
