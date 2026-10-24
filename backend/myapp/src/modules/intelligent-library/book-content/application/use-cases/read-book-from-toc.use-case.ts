import type { ContentExecution } from "../ports/content-execution";
import { ReaderToolException } from "../../domain/reader-tool-error";
import { ReadBookUseCase } from "./read-book.use-case";
import { BookDocumentLoader } from "../book-document.loader";
import { planTocRead, type TocReadInput, TOC_BATCH_CHARACTERS } from "../toc-read-batch";

export class ReadBookFromTocUseCase {
  constructor(
    private readonly documents: BookDocumentLoader,
    private readonly readBook: ReadBookUseCase,
  ) {}

  async plan(userId: number, bookId: number, input: TocReadInput, execution?: ContentExecution) {
    return planTocRead(await this.documents.load(userId, bookId, execution), input);
  }

  async execute(userId: number, bookId: number, input: TocReadInput, execution?: ContentExecution) {
    const plan = await this.plan(userId, bookId, input, execution);
    let text = "";
    const segments: Awaited<ReturnType<ReadBookUseCase["execute"]>>["segments"] = [];
    const units = [];
    for (const unit of plan.units) {
      const result = await this.readBook.execute(userId, { locator: unit.startLocator, endLocator: unit.endLocator,
        direction: "forward", maxChars: TOC_BATCH_CHARACTERS }, execution);
      if (result.text.length !== unit.normalizedCharCount || result.continuation.next !== null) {
        throw new ReaderToolException("EXTRACTION_FAILED", `Incomplete TOC unit '${unit.nodeId}' (${unit.kind}).`);
      }
      const textStart = text.length;
      text += result.text;
      segments.push(...result.segments.map((segment) => ({ ...segment, textStart: textStart + segment.textStart, textEnd: textStart + segment.textEnd })));
      units.push({ ...unit, textStart, textEnd: text.length, boundary: result.boundary, complete: true as const });
    }
    return { text, segments, units, unavailable: plan.unavailable, continuation: plan.continuation, coverage: plan.coverage };
  }
}
