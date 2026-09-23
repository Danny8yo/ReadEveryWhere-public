import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAnnotation = vi.fn();
const updateAnnotation = vi.fn();
const deleteAnnotation = vi.fn();
vi.mock('../features/reader/api/annotationApi', () => ({
  createAnnotation: (...args: unknown[]) => createAnnotation(...args),
  updateAnnotation: (...args: unknown[]) => updateAnnotation(...args),
  deleteAnnotation: (...args: unknown[]) => deleteAnnotation(...args),
}));

import { useAnnotations } from '../composables/useAnnotations';
import type {Annotation} from '../features/reader/model/annotation';

const annotation = (revision = 1, note: string | null = null): Annotation => ({
  id: 'a1', userId: 1, bookId: 42, bookHash: 'hash', annotationType: 'highlight',
  color: '#ffeb3b', location: 'cfi-1', locationType: 'epubcfi', textContent: 'text',
  contextBefore: null, contextAfter: null, chapterLabel: null, sectionIndex: 0,
  textPositionStart: null, textPositionEnd: null, sortKey: 1, note,
  createdAt: 1, updatedAt: revision, revision,
});

describe('useAnnotations online synchronization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the current revision and updates local state only after server confirmation', async () => {
    let resolveRequest!: (value: Annotation) => void;
    updateAnnotation.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    const state = useAnnotations(42);
    state.replaceAnnotations([annotation()]);

    const pending = state.updateAnnotation('a1', { note: 'client' });
    expect(state.annotations.value[0].note).toBeNull();
    expect(updateAnnotation).toHaveBeenCalledWith('a1', { revision: 1, note: 'client' });

    resolveRequest(annotation(2, 'client'));
    await pending;
    expect(state.annotations.value[0]).toMatchObject({ note: 'client', revision: 2 });
  });

  it('preserves attempted edits and exposes the server record on conflict', async () => {
    updateAnnotation.mockRejectedValue({
      details: { reason: 'ANNOTATION_CONFLICT', current: annotation(2, 'server') },
    });
    const state = useAnnotations(42);
    state.replaceAnnotations([annotation()]);

    await state.updateAnnotation('a1', { note: 'client' });
    expect(state.annotations.value[0].note).toBeNull();
    expect(state.conflict.value).toMatchObject({
      current: { revision: 2, note: 'server' },
      attempted: { kind: 'update', edits: { note: 'client' } },
    });
    expect(state.syncStatus.value).toBe('conflict');
  });

  it('does not remove an annotation when delete fails', async () => {
    deleteAnnotation.mockRejectedValue(new Error('network'));
    const state = useAnnotations(42);
    state.replaceAnnotations([annotation()]);
    expect(await state.deleteAnnotation('a1')).toBe(false);
    expect(state.annotations.value).toHaveLength(1);
    expect(state.syncStatus.value).toBe('failed');
  });

  it('restores the server revision and preserves edits for explicit re-editing', async () => {
    updateAnnotation.mockRejectedValue({
      details: { reason: 'ANNOTATION_CONFLICT', current: annotation(2, 'server') },
    });
    const state = useAnnotations(42);
    state.replaceAnnotations([annotation()]);

    await state.updateAnnotation('a1', { note: 'client' });
    const pending = state.prepareConflictRetry();

    expect(pending).toMatchObject({
      current: { revision: 2, note: 'server' },
      attempted: { kind: 'update', edits: { note: 'client' } },
    });
    expect(state.annotations.value[0]).toMatchObject({ revision: 2, note: 'server' });
    expect(state.conflict.value).toBeNull();
    expect(updateAnnotation).toHaveBeenCalledTimes(1);
  });
});
