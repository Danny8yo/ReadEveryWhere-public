import { normalizeAuthors, normalizeOptionalString } from "./library.utils";

export interface BookMetadataValues {
  title: string;
  authors: string[];
  isbn: string | null;
  language: string | null;
  coverUrl: string | null;
  description: string | null;
  publisher: string | null;
  publishYear: number | null;
  editionTag: string | null;
}

export type BookMetadataInput = Readonly<{
  title: string;
  authors: string[];
  isbn?: string | null;
  language?: string | null;
  coverUrl?: string | null;
  description?: string | null;
  publisher?: string | null;
  publishYear?: number | null;
  editionTag?: string | null;
}>;

export type BookMetadataChange = Partial<BookMetadataInput>;

export class BookMetadata {
  private constructor(private readonly values: BookMetadataValues) {}

  static create(input: BookMetadataInput, requireAuthors: boolean): BookMetadata {
    const title = normalizeOptionalString(input.title);
    if (!title) throw new Error("title is required");
    const authors = normalizeAuthors(input.authors ?? []);
    if (requireAuthors && authors.length === 0) {
      throw new Error("authors must contain at least one non-empty value");
    }
    return new BookMetadata({
      title,
      authors,
      isbn: normalizeOptionalString(input.isbn),
      language: normalizeOptionalString(input.language),
      coverUrl: normalizeOptionalString(input.coverUrl),
      description: normalizeOptionalString(input.description),
      publisher: normalizeOptionalString(input.publisher),
      publishYear: typeof input.publishYear === "number" ? input.publishYear : null,
      editionTag: normalizeOptionalString(input.editionTag),
    });
  }

  static createImported(input: BookMetadataInput): BookMetadata {
    if (typeof input.title !== "string" || input.title.length === 0) throw new Error("title is required");
    return new BookMetadata({
      title: input.title,
      authors: normalizeAuthors(input.authors ?? []),
      isbn: normalizeOptionalString(input.isbn),
      language: normalizeOptionalString(input.language),
      coverUrl: normalizeOptionalString(input.coverUrl),
      description: normalizeOptionalString(input.description),
      publisher: normalizeOptionalString(input.publisher),
      publishYear: typeof input.publishYear === "number" ? input.publishYear : null,
      editionTag: normalizeOptionalString(input.editionTag),
    });
  }

  static rehydrate(input: BookMetadataInput): BookMetadata {
    if (typeof input.title !== "string" || input.title.length === 0) throw new Error("title is required");
    return new BookMetadata({
      title: input.title,
      authors: [...(input.authors ?? [])],
      isbn: input.isbn ?? null,
      language: input.language ?? null,
      coverUrl: input.coverUrl ?? null,
      description: input.description ?? null,
      publisher: input.publisher ?? null,
      publishYear: input.publishYear ?? null,
      editionTag: input.editionTag ?? null,
    });
  }

  get snapshot(): BookMetadataValues {
    return { ...this.values, authors: [...this.values.authors] };
  }

  replace(change: BookMetadataChange): BookMetadata {
    const next = this.snapshot;
    if (change.title !== undefined) {
      const title = normalizeOptionalString(change.title);
      if (!title) throw new Error("title is required");
      next.title = title;
    }
    if (change.authors !== undefined) next.authors = normalizeAuthors(change.authors);
    if (change.isbn !== undefined) next.isbn = normalizeOptionalString(change.isbn);
    if (change.language !== undefined) next.language = normalizeOptionalString(change.language);
    if (change.coverUrl !== undefined) next.coverUrl = normalizeOptionalString(change.coverUrl);
    if (change.description !== undefined) next.description = normalizeOptionalString(change.description);
    if (change.publisher !== undefined) next.publisher = normalizeOptionalString(change.publisher);
    if (change.publishYear !== undefined) {
      next.publishYear = typeof change.publishYear === "number" ? change.publishYear : null;
    }
    if (change.editionTag !== undefined) next.editionTag = normalizeOptionalString(change.editionTag);
    return new BookMetadata(next);
  }
}
