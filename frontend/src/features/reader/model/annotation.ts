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
    sectionIndex: number | null;
    textPositionStart: number | null;
    textPositionEnd: number | null;
    sortKey: number | null;
    note: string | null;
    createdAt: number;
    updatedAt: number;
    revision: number;
}
export interface CreateAnnotationParams {
    bookId: number;
    bookHash: string;
    annotationType: AnnotationType;
    color: string;
    location: string;
    locationType?: LocationType;
    textContent: string;
    contextBefore?: string | null;
    contextAfter?: string | null;
    chapterLabel?: string | null;
    sectionIndex?: number | null;
    textPositionStart?: number | null;
    textPositionEnd?: number | null;
    sortKey?: number | null;
    note?: string | null;
}
export interface UpdateAnnotationParams {
    revision: number;
    annotationType?: AnnotationType;
    color?: string;
    note?: string | null;
}
