import type { Annotation, CreateAnnotationParams, UpdateAnnotationParams } from '../model/annotation';
type AnnotationEdits = Omit<UpdateAnnotationParams, "revision">;
export type AnnotationConflict = {
    current: Annotation;
    attempted: {
        kind: "update";
        edits: AnnotationEdits;
    } | {
        kind: "delete";
    };
};
/** 要修改的笔记已在其他设备删除：没有服务器版本，只保留编辑稿供复制或另存。 */
export type AnnotationDeletedRemotely = {
    current: null;
    attempted: {
        kind: "update";
        edits: AnnotationEdits;
    };
};
interface AnnotationGateway {
    create(params: CreateAnnotationParams): Promise<Annotation>;
    update(id: string, params: UpdateAnnotationParams): Promise<Annotation>;
    delete(id: string, revision: number): Promise<{
        deleted: boolean;
    }>;
}
export function createAnnotationsState() {
    return {
        annotations: [] as Annotation[],
        loading: false,
        syncStatus: "idle" as "idle" | "syncing" | "synced" | "failed" | "conflict" | "deleted-remotely",
        lastError: null as unknown,
        conflict: null as AnnotationConflict | AnnotationDeletedRemotely | null,
    };
}
export function createAnnotationsController(state: ReturnType<typeof createAnnotationsState>, api: AnnotationGateway) {
    const { create: apiCreate, update: apiUpdate, delete: apiDelete } = api;
    const derived = { get annotationsByType() {
            return ({
                highlight: state.annotations.filter((a) => a.annotationType === "highlight"),
                underline: state.annotations.filter((a) => a.annotationType === "underline"),
                squiggly: state.annotations.filter((a) => a.annotationType === "squiggly"),
            });
        }, get annotationsWithNotes() { return state.annotations.filter((a) => a.note !== null); } };
    function replaceAnnotations(next: readonly Annotation[]) {
        state.annotations = [...next];
    }
    async function createAnnotation(params: CreateAnnotationParams): Promise<Annotation | null> {
        state.syncStatus = "syncing";
        try {
            const created = await apiCreate(params);
            replaceAnnotation(created);
            state.annotations.sort((a, b) => (a.sortKey ?? 0) - (b.sortKey ?? 0));
            state.syncStatus = "synced";
            state.lastError = null;
            return created;
        }
        catch (e) {
            state.syncStatus = "failed";
            state.lastError = e;
            return null;
        }
    }
    async function updateAnnotation(id: string, edits: AnnotationEdits): Promise<Annotation | null> {
        const existing = state.annotations.find((annotation) => annotation.id === id);
        if (!existing)
            return null;
        state.syncStatus = "syncing";
        try {
            const updated = await apiUpdate(id, { ...edits, revision: existing.revision });
            const idx = state.annotations.findIndex((a) => a.id === id);
            if (idx !== -1)
                state.annotations[idx] = updated;
            state.syncStatus = "synced";
            state.lastError = null;
            return updated;
        }
        catch (e) {
            handleConflict(e, { kind: "update", edits });
            return null;
        }
    }
    function getAnnotationAt(value: string): Annotation | undefined {
        return state.annotations.find((a) => a.location === value);
    }
    async function deleteAnnotation(id: string): Promise<boolean> {
        const existing = state.annotations.find((annotation) => annotation.id === id);
        if (!existing)
            return false;
        state.syncStatus = "syncing";
        try {
            await apiDelete(id, existing.revision);
            state.annotations = state.annotations.filter((a) => a.id !== id);
            state.syncStatus = "synced";
            state.lastError = null;
            return true;
        }
        catch (e) {
            handleConflict(e, { kind: "delete" });
            return false;
        }
    }
    function handleConflict(error: unknown, attempted: AnnotationConflict["attempted"]) {
        const payload = error as {
            code?: number;
            details?: {
                reason?: string;
                current?: Annotation;
            };
        };
        if (payload.details?.reason === "ANNOTATION_CONFLICT" && payload.details.current) {
            state.conflict = { current: payload.details.current, attempted };
            state.syncStatus = "conflict";
        }
        else if (attempted.kind === "update" && payload.code === 40401) {
            state.conflict = { current: null, attempted };
            state.syncStatus = "deleted-remotely";
        }
        else {
            state.syncStatus = "failed";
        }
        state.lastError = error;
    }
    function useServerVersion() {
        if (!state.conflict)
            return;
        const current = state.conflict.current;
        // 已在其他设备删除时服务器没有版本可用：丢弃编辑稿，列表由快照收敛。
        if (current) {
            const index = state.annotations.findIndex((annotation) => annotation.id === current.id);
            if (index >= 0)
                state.annotations[index] = current;
            else
                state.annotations.push(current);
        }
        state.conflict = null;
        state.syncStatus = "synced";
        state.lastError = null;
    }
    function prepareConflictRetry(): AnnotationConflict | null {
        const pendingConflict = state.conflict;
        if (!pendingConflict?.current)
            return null;
        replaceAnnotation(pendingConflict.current);
        state.conflict = null;
        state.syncStatus = "synced";
        state.lastError = null;
        return pendingConflict;
    }
    function replaceAnnotation(annotation: Annotation) {
        const index = state.annotations.findIndex((item) => item.id === annotation.id);
        if (index >= 0)
            state.annotations[index] = annotation;
        else
            state.annotations.push(annotation);
    }
    return { derived, replaceAnnotations, createAnnotation, updateAnnotation, deleteAnnotation, getAnnotationAt, useServerVersion, prepareConflictRetry };
}
