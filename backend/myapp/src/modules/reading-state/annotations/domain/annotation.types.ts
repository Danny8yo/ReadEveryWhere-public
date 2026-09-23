export type AnnotationType = "highlight" | "underline" | "squiggly";

export type LocationType = "epubcfi" | "pdf_page";

export interface Annotation {
  id: string;
  userId: number;
  bookId: number;
  bookHash: string;
  annotationType: AnnotationType;
  color: string;
  location: string;
  locationType: LocationType;
  textContent: string;
  contextBefore: string | null;
  contextAfter: string | null;
  chapterLabel: string | null;
  // 阅读器无关定位（可移植性）：章节 index + 章节规范化文本内的字符偏移
  sectionIndex: number | null;
  textPositionStart: number | null;
  textPositionEnd: number | null;
  sortKey: number | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export interface CreateAnnotationInput {
  id: string;
  userId: number;
  bookId: number;
  bookHash: string;
  annotationType: AnnotationType;
  color: string;
  location: string;
  locationType: LocationType;
  textContent: string;
  contextBefore: string | null;
  contextAfter: string | null;
  chapterLabel: string | null;
  sectionIndex?: number | null;
  textPositionStart?: number | null;
  textPositionEnd?: number | null;
  sortKey: number | null;
  note: string | null;
}

export interface UpdateAnnotationInput {
  userId: number;
  annotationId: string;
  annotationType?: AnnotationType;
  color?: string;
  note?: string | null;
  expectedRevision: number;
}

export type AnnotationWriteResult =
  | { kind: "updated"; annotation: Annotation }
  | { kind: "deleted"; annotation: Annotation }
  | { kind: "not_found" }
  | { kind: "conflict"; current: Annotation };

export interface ListAnnotationsInput {
  userId: number;
  bookId: number;
  type?: AnnotationType;
  hasNote?: boolean;
}
