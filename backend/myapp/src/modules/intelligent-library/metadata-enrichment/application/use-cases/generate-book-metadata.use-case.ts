import { ReaderToolException } from "../../../public";
import type { BookMetadataContentPort, MetadataSection } from "../../../public/book-metadata-content.port";
import type { MetadataGenerationModelPort } from "../ports/metadata-generation-model.port";

const MAX_SELECTED_SECTIONS = 12;
const MAX_SECTION_CHARS = 8_000;
const MAX_TOTAL_CHARS = 24_000;

export class GenerateBookMetadataUseCase {
  constructor(
    private readonly content: BookMetadataContentPort,
    private readonly model: MetadataGenerationModelPort,
  ) {}

  async execute(userId: number, bookId: number, requestId: string) {
    const inspection = await this.content.inspect(userId, bookId);
    const selection = await this.model.selectFrontMatter({
      userId,
      book: inspection.book,
      format: inspection.format,
      sections: inspection.sections.slice(0, 200),
    });
    if (!Array.isArray(selection.sectionIds) || selection.sectionIds.length > MAX_SELECTED_SECTIONS) {
      throw new ReaderToolException("EXTRACTION_FAILED", "AI selected too many metadata sections", "bookId");
    }
    const available = new Set(inspection.sections.map((section) => section.sectionId));
    if (selection.sectionIds.some((sectionId) => typeof sectionId !== "string" || !available.has(sectionId))) {
      throw new ReaderToolException("EXTRACTION_FAILED", "AI selected an unknown metadata section", "bookId");
    }
    const selectedSections = await this.content.readSections(userId, bookId, selection.sectionIds, {
      maxTotalChars: MAX_TOTAL_CHARS,
      maxCharsPerSection: MAX_SECTION_CHARS,
    });
    const draft = await this.model.generateMetadata({ userId, book: inspection.book, selectedSections });
    return {
      sourcePlatform: "AI",
      sourceBookId: `book:${bookId}`,
      sourceUrl: null,
      title: draft.title || inspection.book.title,
      authors: draft.authors.length > 0 ? draft.authors : inspection.book.authors,
      isbn: draft.isbn ?? inspection.book.isbn,
      publisher: draft.publisher ?? inspection.book.publisher,
      publishYear: draft.publishYear ?? inspection.book.publishYear,
      description: draft.description ?? inspection.book.description,
      coverUrl: inspection.book.coverUrl,
      language: draft.language ?? inspection.book.language,
      editionTag: draft.editionTag ?? inspection.book.editionTag,
      requestId,
    };
  }
}
