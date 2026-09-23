export type AnnotationQueryType = "highlight" | "underline" | "squiggly";

export interface AnnotationQuery {
  userId: number;
  bookId: number;
}

export interface AnnotationQueryProjection {
  id: string;
  bookHash: string;
  annotationType: AnnotationQueryType;
  location: string;
  locationType: "epubcfi" | "pdf_page";
  textContent: string;
  contextBefore: string | null;
  contextAfter: string | null;
  chapterLabel: string | null;
  sectionIndex: number | null;
  textPositionStart: number | null;
  textPositionEnd: number | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AnnotationQueryPort {
  listByBook(query: Readonly<AnnotationQuery>): readonly AnnotationQueryProjection[];
}

export const ANNOTATION_QUERY_PORT = Symbol(
  "READING_STATE_ANNOTATION_QUERY_PORT",
);
