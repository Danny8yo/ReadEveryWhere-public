import type { ContentRevision } from "../../book-content/domain/book-document.types";

export const BOOK_READING_GENRES = [
  "technical",
  "argumentation",
  "narrative",
  "paper",
  "poetry",
  "popular-science",
  "self-help",
  "general",
] as const;

export type BookReadingGenre = (typeof BOOK_READING_GENRES)[number];
export type BookAnalysisValidity = "ready" | "stale";

export interface BookReadingProfileCandidateJSON {
  id: string;
  userId: number;
  bookId: number;
  primaryGenre: BookReadingGenre;
  secondaryGenres: BookReadingGenre[];
  traits: string[];
  confidence: number;
  classificationSummary: string;
  contentRevision: ContentRevision;
  modelId: string;
  strategyVersion: string;
  analyzedAt: string;
}

export class BookAnalysisDomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "BookAnalysisDomainError";
  }
}

export class BookReadingProfileCandidate {
  private constructor(private readonly value: BookReadingProfileCandidateJSON) {}

  static create(input: BookReadingProfileCandidateJSON): BookReadingProfileCandidate {
    const primaryGenre = requireGenre(input.primaryGenre);
    const secondaryGenres = unique(input.secondaryGenres.map(requireGenre));
    if (secondaryGenres.includes(primaryGenre)) {
      throw new BookAnalysisDomainError(
        "PROFILE_GENRE_INVALID",
        "Primary genre cannot also be a secondary genre",
      );
    }
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
      throw new BookAnalysisDomainError(
        "PROFILE_CONFIDENCE_INVALID",
        "Confidence must be between 0 and 1",
      );
    }
    requireRevision(input.contentRevision);
    const classificationSummary = requireText(
      input.classificationSummary,
      "PROFILE_SUMMARY_INVALID",
      "Classification summary",
    );
    if (classificationSummary.length > 500) {
      throw new BookAnalysisDomainError(
        "PROFILE_SUMMARY_INVALID",
        "Classification summary must not exceed 500 characters",
      );
    }

    return new BookReadingProfileCandidate({
      id: requireText(input.id, "PROFILE_ID_INVALID", "Profile id"),
      userId: requirePositiveInteger(input.userId, "PROFILE_OWNER_INVALID", "User id"),
      bookId: requirePositiveInteger(input.bookId, "PROFILE_BOOK_INVALID", "Book id"),
      primaryGenre,
      secondaryGenres,
      traits: unique(input.traits.map((trait) => trait.trim()).filter(Boolean)),
      confidence: input.confidence,
      classificationSummary,
      contentRevision: cloneRevision(input.contentRevision),
      modelId: requireText(input.modelId, "PROFILE_MODEL_INVALID", "Model id"),
      strategyVersion: requireText(
        input.strategyVersion,
        "PROFILE_STRATEGY_INVALID",
        "Strategy version",
      ),
      analyzedAt: requireText(input.analyzedAt, "PROFILE_DATE_INVALID", "Analyzed at"),
    });
  }

  static fromJSON(input: BookReadingProfileCandidateJSON): BookReadingProfileCandidate {
    return BookReadingProfileCandidate.create(input);
  }

  get id() { return this.value.id; }
  get userId() { return this.value.userId; }
  get bookId() { return this.value.bookId; }
  get primaryGenre() { return this.value.primaryGenre; }
  get secondaryGenres() { return [...this.value.secondaryGenres]; }
  get traits() { return [...this.value.traits]; }
  get confidence() { return this.value.confidence; }
  get classificationSummary() { return this.value.classificationSummary; }
  get contentRevision() { return cloneRevision(this.value.contentRevision); }
  get modelId() { return this.value.modelId; }
  get strategyVersion() { return this.value.strategyVersion; }
  get analyzedAt() { return this.value.analyzedAt; }

  validityFor(
    contentRevision: ContentRevision,
    strategyVersion: string,
  ): BookAnalysisValidity {
    return revisionsEqual(this.value.contentRevision, contentRevision)
      && this.value.strategyVersion === strategyVersion
      ? "ready"
      : "stale";
  }

  toJSON(): BookReadingProfileCandidateJSON {
    return {
      ...this.value,
      secondaryGenres: [...this.value.secondaryGenres],
      traits: [...this.value.traits],
      contentRevision: cloneRevision(this.value.contentRevision),
    };
  }
}

export function revisionsEqual(left: ContentRevision, right: ContentRevision): boolean {
  return left.fileChecksum === right.fileChecksum
    && left.extractorVersion === right.extractorVersion
    && left.normalizationVersion === right.normalizationVersion;
}

function requireGenre(value: unknown): BookReadingGenre {
  if (typeof value !== "string" || !BOOK_READING_GENRES.includes(value as BookReadingGenre)) {
    throw new BookAnalysisDomainError("PROFILE_GENRE_INVALID", "Unsupported book reading genre");
  }
  return value as BookReadingGenre;
}

function requireRevision(value: ContentRevision | null | undefined): asserts value is ContentRevision {
  if (!value
    || typeof value.fileChecksum !== "string"
    || typeof value.extractorVersion !== "string"
    || typeof value.normalizationVersion !== "string"
    || !value.fileChecksum.trim()
    || !value.extractorVersion.trim()
    || !value.normalizationVersion.trim()) {
    throw new BookAnalysisDomainError(
      "PROFILE_REVISION_INVALID",
      "A complete content revision is required",
    );
  }
}

function cloneRevision(value: ContentRevision): ContentRevision {
  return {
    fileChecksum: value.fileChecksum,
    extractorVersion: value.extractorVersion,
    normalizationVersion: value.normalizationVersion,
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function requireText(value: unknown, code: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BookAnalysisDomainError(code, `${label} is required`);
  }
  return value.trim();
}

function requirePositiveInteger(value: number, code: string, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new BookAnalysisDomainError(code, `${label} must be a positive integer`);
  }
  return value;
}
