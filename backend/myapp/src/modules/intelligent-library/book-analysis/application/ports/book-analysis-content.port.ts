import type { ContentRevision } from "../../../book-content/domain/book-document.types";
import type { ClassificationSample } from "./book-classifier.port";

export interface BookAnalysisInspection {
  baseProfileVersion: number;
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
}

export interface RepresentativeSampleRequest {
  userId: number;
  bookId: number;
  contentRevision: ContentRevision;
  maxSections: number;
  maxTotalCharacters: number;
  maxCharactersPerSection: number;
}

export interface BookAnalysisContentPort {
  inspect(userId: number, bookId: number): Promise<BookAnalysisInspection>;
  currentRevision(userId: number, bookId: number): Promise<ContentRevision>;
  sampleRepresentativeText(input: RepresentativeSampleRequest): Promise<ClassificationSample[]>;
}
