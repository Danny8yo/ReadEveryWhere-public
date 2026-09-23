import { randomUUID } from "node:crypto";
import { BookMetadata, BookMetadataChange, BookMetadataInput, BookMetadataValues } from "./book-metadata";
import {
  BookProfileDomainError,
  BookReadingProfile,
  type BookReadingProfileJSON,
  type EditBookReadingProfile,
  type BookReadingGenre,
} from "./book-reading-profile";
import { SourceReference, SourceReferenceInput, SourceReferenceValues } from "./source-reference";

export type BookId = number;

interface CreateBookProps {
  ownerId: number;
  metadata: BookMetadataInput;
  sourceReference?: SourceReferenceInput;
  now?: string;
  profileIdFactory?: () => string;
}

interface CreateImportedBookProps extends CreateBookProps {
  authorsText: string;
}

interface RehydrateBookProps {
  id: BookId;
  ownerId: number;
  metadata: BookMetadataInput;
  authorsText?: string;
  sourceReferences: SourceReferenceInput[];
  version: number;
  createdAt: string;
  updatedAt: string;
  readingProfile: BookReadingProfileJSON;
}

export interface BookProfileCandidate {
  candidateId: string;
  bookId: number;
  baseProfileVersion: number;
  primaryGenre: BookReadingGenre;
  secondaryGenres: BookReadingGenre[];
  traits: string[];
  confidence: number;
  classificationSummary: string;
  contentRevision: BookContentRevision;
  modelId: string;
  strategyVersion: string;
  analyzedAt: string;
}

export interface BookContentRevision {
  fileChecksum: string;
  extractorVersion: string;
  normalizationVersion: string;
}

export class Book {
  private constructor(
    private readonly bookId: BookId | null,
    private readonly bookOwnerId: number,
    private bookMetadata: BookMetadata,
    private bookAuthorsText: string,
    private readonly bookSourceReferences: SourceReference[],
    private readonly bookReadingProfile: BookReadingProfile,
    private bookVersion: number,
    private readonly bookCreatedAt: string,
    private bookUpdatedAt: string,
  ) {}

  static create(input: CreateBookProps): Book {
    return Book.createNew(input, true);
  }

  static createImported(input: CreateImportedBookProps): Book {
    // COMPATIBILITY: local import historically permits metadata with no authors.
    if (!Number.isInteger(input.ownerId) || input.ownerId < 1) throw new Error("ownerId is invalid");
    const now = input.now ?? new Date().toISOString();
    const sourceReferences = input.sourceReference
      ? [SourceReference.create(input.sourceReference)]
      : [];
    return new Book(
      null,
      input.ownerId,
      BookMetadata.createImported(input.metadata),
      input.authorsText,
      sourceReferences,
      BookReadingProfile.empty({ id: input.profileIdFactory?.() ?? randomUUID(), now }),
      1,
      now,
      now,
    );
  }

  private static createNew(input: CreateBookProps, requireAuthors: boolean): Book {
    if (!Number.isInteger(input.ownerId) || input.ownerId < 1) throw new Error("ownerId is invalid");
    const now = input.now ?? new Date().toISOString();
    const sourceReferences = input.sourceReference
      ? [SourceReference.create(input.sourceReference)]
      : [];
    const metadata = BookMetadata.create(input.metadata, requireAuthors);
    return new Book(
      null,
      input.ownerId,
      metadata,
      metadata.snapshot.authors.join(", "),
      sourceReferences,
      BookReadingProfile.empty({ id: input.profileIdFactory?.() ?? randomUUID(), now }),
      1,
      now,
      now,
    );
  }

  static rehydrate(input: RehydrateBookProps): Book {
    if (!Number.isInteger(input.id) || input.id < 1) throw new Error("bookId is invalid");
    if (!Number.isInteger(input.ownerId) || input.ownerId < 1) throw new Error("ownerId is invalid");
    if (!Number.isInteger(input.version) || input.version < 1) throw new Error("version is invalid");
    return new Book(
      input.id,
      input.ownerId,
      BookMetadata.rehydrate(input.metadata),
      input.authorsText ?? input.metadata.authors.join(", "),
      input.sourceReferences.map(SourceReference.rehydrate),
      BookReadingProfile.rehydrate(input.readingProfile),
      input.version,
      input.createdAt,
      input.updatedAt,
    );
  }

  get id(): BookId | null { return this.bookId; }
  get ownerId(): number { return this.bookOwnerId; }
  get metadata(): BookMetadataValues { return this.bookMetadata.snapshot; }
  get authorsTextForPersistence(): string { return this.bookAuthorsText; }
  get sourceReferences(): SourceReferenceValues[] {
    return this.bookSourceReferences.map((source) => source.snapshot);
  }
  get readingProfile(): BookReadingProfileJSON { return this.bookReadingProfile.toJSON(); }
  get version(): number { return this.bookVersion; }
  get createdAt(): string { return this.bookCreatedAt; }
  get updatedAt(): string { return this.bookUpdatedAt; }

  editMetadata(change: BookMetadataChange, now = new Date().toISOString()): boolean {
    // COMPATIBILITY: create rejects empty authors, while historical update accepts clearing authors.
    return this.applyMetadataChange(change, now);
  }

  addSourceReference(input: SourceReferenceInput, now = new Date().toISOString()): void {
    const source = SourceReference.create(input);
    if (this.bookSourceReferences.some((existing) => existing.hasSameIdentity(source))) {
      throw new Error("Source reference already exists");
    }
    this.bookSourceReferences.push(source);
    this.bookVersion += 1;
    this.bookUpdatedAt = now;
  }

  editReadingProfile(change: EditBookReadingProfile, now = new Date().toISOString()): boolean {
    const changed = this.bookReadingProfile.editByUser(change, now);
    if (changed) this.advanceVersion(now);
    return changed;
  }

  applyAnalysisCandidate(
    candidate: BookProfileCandidate,
    currentContentRevision: BookContentRevision,
    override: boolean,
    now = new Date().toISOString(),
  ): boolean {
    if (this.bookId === null || candidate.bookId !== this.bookId) {
      throw new BookProfileDomainError(
        "PROFILE_CANDIDATE_BOOK_MISMATCH",
        "Candidate does not belong to this Book",
      );
    }
    if (!override && candidate.baseProfileVersion !== this.bookReadingProfile.profileVersion) {
      throw new BookProfileDomainError(
        "PROFILE_VERSION_CONFLICT",
        "The reading profile changed after this candidate was generated",
      );
    }
    if (!sameRevision(candidate.contentRevision, currentContentRevision)) {
      throw new BookProfileDomainError(
        "PROFILE_CANDIDATE_REVISION_CHANGED",
        "Candidate content revision is no longer current",
      );
    }
    const changed = this.bookReadingProfile.applyAnalysis({
      primaryGenre: candidate.primaryGenre,
      secondaryGenres: candidate.secondaryGenres,
      traits: candidate.traits,
      confidence: candidate.confidence,
      classificationSummary: candidate.classificationSummary,
    }, now);
    if (changed) this.advanceVersion(now);
    return changed;
  }

  clearReadingProfile(reason: "manual" | "file-replacement", now = new Date().toISOString()): boolean {
    if (reason === "file-replacement") {
      this.bookReadingProfile.resetForContentReplacement(now);
      this.advanceVersion(now);
      return true;
    }
    const changed = this.bookReadingProfile.clear(now);
    if (changed) this.advanceVersion(now);
    return changed;
  }

  private applyMetadataChange(
    change: BookMetadataChange,
    now: string,
  ): boolean {
    const acceptedEntries = Object.entries(change).filter(([, value]) => value !== undefined);
    if (acceptedEntries.length === 0) return false;

    const before = this.bookMetadata.snapshot;
    this.bookMetadata = this.bookMetadata.replace(change);
    const after = this.bookMetadata.snapshot;
    if (change.authors !== undefined) this.bookAuthorsText = after.authors.join(", ");
    this.bookVersion += 1;
    this.bookUpdatedAt = now;
    return true;
  }

  private advanceVersion(now: string): void {
    this.bookVersion += 1;
    this.bookUpdatedAt = now;
  }
}

function sameRevision(left: BookContentRevision, right: BookContentRevision): boolean {
  return left.fileChecksum === right.fileChecksum
    && left.extractorVersion === right.extractorVersion
    && left.normalizationVersion === right.normalizationVersion;
}
