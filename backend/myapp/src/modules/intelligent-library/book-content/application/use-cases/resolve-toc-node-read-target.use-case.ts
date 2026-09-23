import { ReaderToolException } from "../../domain/reader-tool-error";
import { BookDocumentLoader } from "../book-document.loader";
import { resolveTocNodeRange } from "../toc-node-range.resolver";

export class ResolveTocNodeReadTargetUseCase {
  constructor(private readonly documentLoader: BookDocumentLoader) {}

  async execute(
    userId: number,
    bookId: number,
    input: { nodeId: string; direction?: "forward" | "backward" },
  ) {
    const document = await this.documentLoader.load(userId, bookId);
    const range = resolveTocNodeRange(document, input.nodeId);
    if (!range.readable) {
      throw new ReaderToolException(
        "TOC_NODE_NOT_READABLE",
        `TOC node '${input.nodeId}' does not cover readable normalized text. Select a readable child or adjacent node.`,
        "nodeId",
      );
    }
    const direction = input.direction ?? "forward";
    return {
      locator: direction === "forward" ? range.startLocator : range.endLocator,
      endLocator: direction === "forward" ? range.endLocator : range.startLocator,
      direction,
      node: {
        nodeId: range.node.nodeId,
        label: range.node.label,
        normalizedCharCount: range.normalizedCharCount,
      },
    };
  }
}
