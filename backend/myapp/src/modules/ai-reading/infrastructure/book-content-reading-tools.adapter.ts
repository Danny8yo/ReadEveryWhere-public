import { Injectable } from "@nestjs/common";
import { GetBookMetadataUseCase } from "../../../interface-adapters/reader-tools-http/application/get-book-metadata.use-case";
import { ListBookAnnotationsUseCase } from "../../../interface-adapters/reader-tools-http/application/list-book-annotations.use-case";
import {
  ReaderToolException,
  type BookContentAccessPort,
} from "../../intelligent-library/public";
import type { BookScope } from "../domain";
import type {
  ContentRevision,
  EpubBookLocatorV1,
  ReadingToolExecution,
  ReadingToolsPort,
} from "../application/ports/reading-tools.port";

@Injectable()
export class BookContentReadingToolsAdapter implements ReadingToolsPort {
  constructor(
    private readonly bookContent: BookContentAccessPort,
    private readonly getMetadata: GetBookMetadataUseCase,
    private readonly listAnnotations: ListBookAnnotationsUseCase,
  ) {}

  async preflight(scope: BookScope): Promise<unknown> {
    const metadata = await this.inspectOwnedBook(Number(scope.userId), Number(scope.bookId));
    this.requireCurrentRevision(scope, metadata.contentRevision);
    return metadata;
  }

  async inspectOwnedBook(userId: number, bookId: number) {
    return this.getMetadata.execute(userId, bookId);
  }

  async planTocRead(
    scope: BookScope,
    input: { nodeIds?: string[]; cursor?: string },
  ) {
    const document = await this.bookContent.loadDocument(Number(scope.userId), Number(scope.bookId));
    this.requireCurrentRevision(scope, document.revision);
    return this.bookContent.planTocRead(
      Number(scope.userId),
      Number(scope.bookId),
      input,
    );
  }

  async execute(scope: BookScope, toolName: string, argumentsValue: any): Promise<ReadingToolExecution> {
    const userId = Number(scope.userId);
    const bookId = Number(scope.bookId);
    let output: any;

    switch (toolName) {
      case "book_toc":
        output = await this.bookContent.getToc(userId, bookId, {
          mode: "outline",
          cursor: argumentsValue.cursor,
          limit: argumentsValue.limit,
        });
        break;
      case "book_toc_tree":
        output = await this.bookContent.getToc(userId, bookId, { mode: "tree" });
        break;
      case "book_toc_navigation":
        output = await this.bookContent.getToc(userId, bookId, {
          mode: "navigation",
          nodeIds: argumentsValue.nodeIds,
        });
        break;
      case "book_read": {
        const locator = this.scopedLocator(scope, argumentsValue.locator);
        const endLocator = argumentsValue.endLocator
          ? this.scopedLocator(scope, argumentsValue.endLocator)
          : undefined;
        output = await this.bookContent.read(userId, {
          locator,
          endLocator,
          direction: argumentsValue.direction,
          maxChars: argumentsValue.maxChars,
        });
        return {
          output,
          readSource: {
            text: String(output.text ?? ""),
            segments: output.segments as Array<{
              textStart: number;
              textEnd: number;
              citation: Record<string, unknown>;
            }>,
          },
        };
      }
      case "book_read_from_toc": {
        const document = await this.bookContent.loadDocument(userId, bookId);
        this.requireCurrentRevision(scope, document.revision);
        output = await this.bookContent.readFromToc(userId, bookId, argumentsValue);
        return {
          output,
          readSource: {
            text: output.text,
            segments: output.segments as Array<{
              textStart: number;
              textEnd: number;
              citation: Record<string, unknown>;
            }>,
          },
        };
      }
      case "book_search_text":
        output = await this.bookContent.searchText(userId, bookId, argumentsValue);
        break;
      case "book_list_annotations":
        output = await this.listAnnotations.execute(userId, bookId, argumentsValue);
        break;
      default:
        throw new ReaderToolException("TOC_REQUEST_INVALID", `Reading tool '${toolName}' is not available`);
    }

    if (output?.contentRevision) this.requireCurrentRevision(scope, output.contentRevision);
    return { output };
  }

  resolveReaderFocus(
    userId: number,
    input: Parameters<ReadingToolsPort["resolveReaderFocus"]>[1],
  ) {
    return this.bookContent.resolveReaderFocus(userId, input);
  }

  replayRange(
    userId: number,
    input: Parameters<ReadingToolsPort["replayRange"]>[1],
  ) {
    return this.bookContent.replayRange(userId, input);
  }

  private scopedLocator(scope: BookScope, locator: Omit<EpubBookLocatorV1, "bookId" | "contentRevision">): EpubBookLocatorV1 {
    return {
      ...locator,
      bookId: Number(scope.bookId),
      contentRevision: JSON.parse(scope.contentRevision) as ContentRevision,
    };
  }

  private requireCurrentRevision(scope: BookScope, revision: ContentRevision): void {
    const expected = canonicalJson(JSON.parse(scope.contentRevision));
    const actual = canonicalJson(revision);
    if (expected !== actual) {
      throw new ReaderToolException(
        "CONTENT_REVISION_MISMATCH",
        "Book content changed after the reading task was created",
        "contentRevision",
      );
    }
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
