import type { AnnotationType, Annotation, CreateAnnotationParams, UpdateAnnotationParams } from '../model/annotation';
import { request } from "../../../shared/web/apiClient";
export const createAnnotation = (params: CreateAnnotationParams): Promise<Annotation> => {
    return request<Annotation>("/api/v1/annotations", {
        method: "POST",
        body: JSON.stringify(params),
    });
};
export const updateAnnotation = (id: string, params: UpdateAnnotationParams): Promise<Annotation> => {
    return request<Annotation>(`/api/v1/annotations/${id}`, {
        method: "PATCH",
        body: JSON.stringify(params),
    });
};
export const deleteAnnotation = (id: string, revision: number): Promise<{
    deleted: boolean;
}> => {
    return request<{
        deleted: boolean;
    }>(`/api/v1/annotations/${id}`, {
        method: "DELETE",
        params: { revision },
    });
};
export const listAnnotations = (bookId: number, opts?: {
    type?: AnnotationType;
    hasNote?: boolean;
}): Promise<Annotation[]> => {
    const params: Record<string, string | number> = { bookId };
    if (opts?.type)
        params.type = opts.type;
    if (opts?.hasNote !== undefined)
        params.hasNote = String(opts.hasNote);
    return request<Annotation[]>("/api/v1/annotations", { method: "GET", params });
};
