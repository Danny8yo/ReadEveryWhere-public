import type { Annotation } from './annotation';
import type { BookmarkRecord } from './bookmark';
import type { ReadingProgressRecord } from './progress';
export type ReadingStateChangeKind = 'progress' | 'bookmarks' | 'annotations';
export interface ReadingStateSnapshot {
    revision: number;
    progress: ReadingProgressRecord | null;
    bookmarks: BookmarkRecord[];
    annotations: Annotation[];
}
export interface ReadingStateChangedEvent {
    bookId: number;
    revision: number;
    changed: ReadingStateChangeKind[];
}
export interface ReadingStateStreamHandlers {
    onChange: (event: ReadingStateChangedEvent) => void | Promise<void>;
    onOpen?: () => void | Promise<void>;
    onError?: (error: unknown) => void;
}
