import { z } from "zod";
import {
  BOOK_READING_GENRES,
  type BookReadingGenre,
} from "../domain/book-reading-profile-candidate";

const classificationSchema = z.strictObject({
  primaryGenre: z.enum(BOOK_READING_GENRES),
  secondaryGenres: z.array(z.enum(BOOK_READING_GENRES)),
  traits: z.array(z.string().trim().min(1).max(80).refine(containsChinese, {
    message: "must_include_chinese",
  })).min(1).max(20),
  confidence: z.number().finite().min(0).max(1),
  classificationSummary: z.string().trim().min(1).max(500).refine(containsChinese, {
    message: "must_include_chinese",
  }),
});

export interface BookClassification {
  primaryGenre: BookReadingGenre;
  secondaryGenres: BookReadingGenre[];
  traits: string[];
  confidence: number;
  classificationSummary: string;
}

export interface BookClassificationIssue {
  path: string;
  code: string;
}

export type BookClassificationErrorCode =
  | "CLASSIFICATION_SCHEMA_INVALID"
  | "CLASSIFICATION_REFUSED"
  | "CLASSIFICATION_TIMEOUT"
  | "CLASSIFICATION_UNAVAILABLE";

export class BookClassificationError extends Error {
  constructor(
    public readonly code: BookClassificationErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly issues: readonly BookClassificationIssue[] = [],
  ) {
    super(message);
    this.name = "BookClassificationError";
  }
}

export function parseBookClassificationResponse(value: unknown): BookClassification {
  const parsed = classificationSchema.safeParse(value);
  if (!parsed.success) {
    throw new BookClassificationError(
      "CLASSIFICATION_SCHEMA_INVALID",
      "The model returned an invalid book classification",
      false,
      sanitizedIssues(parsed.error.issues),
    );
  }
  return {
    ...parsed.data,
    secondaryGenres: [...new Set(parsed.data.secondaryGenres)],
    traits: [...new Set(parsed.data.traits)],
  };
}

function sanitizedIssues(
  issues: readonly z.core.$ZodIssue[],
): BookClassificationIssue[] {
  const seen = new Set<string>();
  const result: BookClassificationIssue[] = [];
  for (const issue of issues) {
    const path = issue.path.length > 0
      ? issue.path.map((segment) => String(segment)).join(".")
      : "$";
    const key = `${path}:${issue.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ path, code: issue.code });
    if (result.length >= 10) break;
  }
  return result.length > 0 ? result : [{ path: "$", code: "schema_invalid" }];
}

function containsChinese(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}
