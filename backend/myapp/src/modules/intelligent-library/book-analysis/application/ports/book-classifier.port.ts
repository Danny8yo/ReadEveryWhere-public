import type { ContentRevision, EpubBookLocatorV1 } from "../../../book-content/domain/book-document.types";
import type { BookClassificationIssue } from "../classification-response";

export const BOOK_CLASSIFIER_PORT = Symbol("BOOK_CLASSIFIER_PORT");

export const BOOK_CLASSIFICATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "primaryGenre",
    "secondaryGenres",
    "traits",
    "confidence",
    "classificationSummary",
  ],
  properties: {
    primaryGenre: {
      type: "string",
      enum: [
        "technical", "argumentation", "narrative", "paper", "poetry",
        "popular-science", "self-help", "general",
      ],
    },
    secondaryGenres: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "technical", "argumentation", "narrative", "paper", "poetry",
          "popular-science", "self-help", "general",
        ],
      },
    },
    traits: { type: "array", items: { type: "string", maxLength: 80 }, minItems: 1, maxItems: 20 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    classificationSummary: { type: "string", minLength: 1, maxLength: 500 },
  },
} as const;

export interface ClassificationSample {
  text: string;
  locator: EpubBookLocatorV1;
  chapterPath: string | null;
}

export interface BookClassifierInput {
  providerId: string;
  modelId: string;
  apiKey: string;
  book: {
    bookId: number;
    title: string;
    authors: string[];
    description: string | null;
    format: "epub";
  };
  contentRevision: ContentRevision;
  toc: Array<{ nodeId: string; label: string; path: string }>;
  contentStats: { sectionCount: number; tocNodeCount: number; charCount: number };
  samples?: ClassificationSample[];
  repair?: {
    attempt: number;
    issues: readonly BookClassificationIssue[];
  };
  responseSchema: typeof BOOK_CLASSIFICATION_JSON_SCHEMA;
}

export interface BookClassifierPort {
  classify(input: BookClassifierInput): Promise<unknown>;
}
