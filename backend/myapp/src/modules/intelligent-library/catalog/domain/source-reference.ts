import { normalizeOptionalString } from "./library.utils";
import { EBOOK_FORMATS, type EbookFormat } from "./ebook-format";

export interface SourceReferenceValues {
  platform: string;
  sourceBookId: string | null;
  sourceUrl: string | null;
  hash: string | null;
  format: EbookFormat | null;
  availability: string;
}

export type SourceReferenceInput = Readonly<{
  platform: string;
  sourceBookId?: string | null;
  sourceUrl?: string | null;
  hash?: string | null;
  format?: EbookFormat | null;
  availability?: string;
}>;

export class SourceReference {
  private constructor(private readonly values: SourceReferenceValues) {}

  static create(input: SourceReferenceInput): SourceReference {
    const platform = normalizeOptionalString(input.platform)?.toLowerCase();
    if (!platform) throw new Error("sourcePlatform is required");
    const sourceBookId = normalizeOptionalString(input.sourceBookId);
    const format = input.format ?? null;
    if (format !== null && !EBOOK_FORMATS.includes(format)) {
      throw new Error("source format is invalid");
    }
    if (platform !== "manual" && !sourceBookId) {
      throw new Error("sourceBookId is required when sourcePlatform is not manual");
    }
    return new SourceReference({
      platform,
      sourceBookId,
      sourceUrl: normalizeOptionalString(input.sourceUrl),
      hash: normalizeOptionalString(input.hash),
      format,
      availability: normalizeOptionalString(input.availability) ?? "available",
    });
  }

  static rehydrate(input: SourceReferenceInput): SourceReference {
    if (typeof input.platform !== "string" || input.platform.length === 0) {
      throw new Error("sourcePlatform is required");
    }
    return new SourceReference({
      platform: input.platform,
      sourceBookId: input.sourceBookId ?? null,
      sourceUrl: input.sourceUrl ?? null,
      hash: input.hash ?? null,
      format: input.format ?? null,
      availability: input.availability ?? "available",
    });
  }

  get snapshot(): SourceReferenceValues {
    return { ...this.values };
  }

  hasSameIdentity(other: SourceReference): boolean {
    return this.values.platform === other.values.platform
      && this.values.sourceBookId === other.values.sourceBookId;
  }
}
