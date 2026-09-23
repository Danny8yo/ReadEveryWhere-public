import { errorMessage } from '../../../shared/domain/errors';
import type { LibraryBook } from '../../library/model/library';
import type { MatchedMetadataCandidate, MetadataProvider } from '../model/metadata';
import { buildMetadataScrapeKeyword } from './keyword';
export type EntryStatus = 'pending' | 'searching' | 'review' | 'accepted' | 'no_candidates' | 'failed' | 'skipped' | 'applying' | 'applied' | 'unchanged' | 'apply_failed';
export interface ReviewEntry {
    book: LibraryBook;
    keyword: string;
    status: EntryStatus;
    candidates: MatchedMetadataCandidate[];
    selectedIndex: number | null;
    error: string | null;
    resultNote: string | null;
}
export interface BatchReviewEvents {
    (event: 'busy-change', busy: boolean): void;
    (event: 'progress', done: number, total: number): void;
    (event: 'applied', result: {
        applied: number;
        unchanged: number;
        failed: number;
    }): void;
}
export interface MetadataGateway {
    reloadBook(id: number): Promise<LibraryBook>;
    scrapeMetadata(input: {
        provider: 'zlibrary' | 'douban';
        bookId: number;
        keyword: string;
    } | {
        provider: 'AI';
        bookId: number;
    }): Promise<MatchedMetadataCandidate[]>;
    applyMetadataToBook(bookId: number, expectedVersion: number, data: import('../model/metadata').ScrapedResult): Promise<LibraryBook>;
}
export function createBatchReviewState() {
    return {
        entries: [] as ReviewEntry[],
        activeBookId: null as number | null,
        collecting: false,
        applying: false,
        collectDone: 0,
        applyDone: 0,
        applyTotal: 0,
    };
}
export function createBatchReviewController(state: ReturnType<typeof createBatchReviewState>, input: {
    books: LibraryBook[];
    provider: MetadataProvider;
}, api: MetadataGateway, emit: BatchReviewEvents) {
    const { scrapeMetadata, applyMetadataToBook } = api;
    const derived = { get busy() { return state.collecting || state.applying; },
        get activeEntry() { return state.entries.find((entry) => entry.book.id === state.activeBookId) ?? null; },
        get acceptedCount() { return state.entries.filter((entry) => entry.status === 'accepted').length; },
        get reviewCount() { return state.entries.filter((entry) => entry.status === 'review').length; },
        get appliedCount() { return state.entries.filter((entry) => entry.status === 'applied').length; },
        get unchangedCount() { return state.entries.filter((entry) => entry.status === 'unchanged').length; },
        get noCandidateCount() { return state.entries.filter((entry) => entry.status === 'no_candidates').length; },
        get failedCount() { return state.entries.filter((entry) => entry.status === 'failed' || entry.status === 'apply_failed').length; },
        get progressPercent() { return input.books.length === 0 ? 0 : Math.round((state.collectDone / input.books.length) * 100); },
        get providerLabel() { return ({ zlibrary: 'Z-Library', douban: '豆瓣', AI: 'AI' })[input.provider]; } };
    let runGeneration = 0;
    async function collectCandidates() {
        const generation = ++runGeneration;
        state.entries = input.books.map((book) => ({
            book: { ...book, authors: [...book.authors] },
            keyword: buildMetadataScrapeKeyword(book),
            status: 'pending',
            candidates: [],
            selectedIndex: null,
            error: null,
            resultNote: null,
        }));
        state.activeBookId = state.entries[0]?.book.id ?? null;
        state.collectDone = 0;
        state.collecting = true;
        emit('busy-change', true);
        emit('progress', 0, state.entries.length);
        for (const entry of state.entries) {
            if (generation !== runGeneration)
                return;
            await searchEntry(entry);
            if (generation !== runGeneration)
                return;
            state.collectDone++;
            emit('progress', state.collectDone, state.entries.length);
        }
        if (generation !== runGeneration)
            return;
        state.collecting = false;
        emit('busy-change', false);
        focusNextReview();
    }
    async function searchEntry(entry: ReviewEntry) {
        const generation = runGeneration;
        entry.status = 'searching';
        entry.error = null;
        entry.resultNote = null;
        entry.candidates = [];
        entry.selectedIndex = null;
        try {
            const candidates = await scrapeMetadata(input.provider === 'AI'
                ? { provider: 'AI', bookId: entry.book.id }
                : { provider: input.provider, bookId: entry.book.id, keyword: entry.keyword.trim() });
            if (generation !== runGeneration)
                return;
            entry.candidates = candidates;
            if (candidates.length === 0) {
                entry.status = 'no_candidates';
                return;
            }
            entry.selectedIndex = 0;
            entry.status = candidates[0].match.level === 'edition' ? 'accepted' : 'review';
        }
        catch (cause) {
            if (generation !== runGeneration)
                return;
            entry.status = 'failed';
            entry.error = errorMessage(cause);
        }
    }
    async function retryActive() {
        const entry = derived.activeEntry;
        if (!entry || derived.busy)
            return;
        state.collecting = true;
        emit('busy-change', true);
        const generation = runGeneration;
        try {
            const current = await api.reloadBook(entry.book.id);
            if (generation !== runGeneration)
                return;
            entry.book = current;
        }
        catch (cause) {
            if (generation !== runGeneration)
                return;
            entry.status = 'failed';
            entry.error = errorMessage(cause);
            state.collecting = false;
            emit('busy-change', false);
            return;
        }
        await searchEntry(entry);
        if (generation !== runGeneration)
            return;
        state.collecting = false;
        emit('busy-change', false);
    }
    function selectCandidate(index: number) {
        const entry = derived.activeEntry;
        if (!entry || derived.busy || entry.status === 'apply_failed')
            return;
        if (!entry.candidates[index])
            throw new Error(`无效候选索引：${index}`);
        entry.selectedIndex = index;
        entry.status = 'review';
    }
    function confirmActive() {
        const entry = derived.activeEntry;
        if (!entry || entry.selectedIndex === null || derived.busy || entry.status === 'apply_failed')
            return;
        entry.status = 'accepted';
        focusNextReview(entry.book.id);
    }
    function skipActive() {
        const entry = derived.activeEntry;
        if (!entry || derived.busy)
            return;
        entry.status = 'skipped';
        focusNextReview(entry.book.id);
    }
    function focusNextReview(excludeBookId?: number) {
        const next = state.entries.find((entry) => entry.book.id !== excludeBookId && entry.status === 'review')
            ?? state.entries.find((entry) => entry.book.id !== excludeBookId && (entry.status === 'failed' || entry.status === 'no_candidates'))
            ?? state.entries.find((entry) => entry.status === 'accepted')
            ?? state.entries[0];
        state.activeBookId = next?.book.id ?? null;
    }
    async function applyConfirmed() {
        const generation = runGeneration;
        const targets = state.entries.filter((entry) => entry.status === 'accepted' && entry.selectedIndex !== null);
        if (derived.busy || targets.length === 0)
            return;
        state.applying = true;
        state.applyDone = 0;
        state.applyTotal = targets.length;
        emit('busy-change', true);
        let applied = 0;
        let unchanged = 0;
        let failed = 0;
        for (const entry of targets) {
            if (generation !== runGeneration)
                return;
            const selected = entry.candidates[entry.selectedIndex!];
            entry.status = 'applying';
            entry.error = null;
            entry.resultNote = null;
            try {
                const before = entry.book;
                const result = await applyMetadataToBook(entry.book.id, before.version, selected.candidate);
                if (generation !== runGeneration)
                    return;
                entry.book = result;
                const changed = metadataFields.some((field) => !sameMetadataValue(before[field], result[field]));
                if (changed) {
                    entry.status = 'applied';
                    applied++;
                }
                else {
                    entry.status = 'unchanged';
                    entry.resultNote = '候选元数据与当前书籍相同';
                    unchanged++;
                }
            }
            catch (cause) {
                if (generation !== runGeneration)
                    return;
                entry.status = 'apply_failed';
                entry.error = errorMessage(cause);
                failed++;
            }
            finally {
                if (generation === runGeneration)
                    state.applyDone++;
            }
        }
        state.applying = false;
        emit('busy-change', false);
        emit('applied', { applied, unchanged, failed });
    }
    function dispose() { runGeneration++; state.collecting = false; state.applying = false; }
    return { derived, collectCandidates, retryActive, selectCandidate, confirmActive, skipActive, applyConfirmed, dispose };
}
type MetadataField = 'title' | 'authors' | 'isbn' | 'language' | 'coverUrl' | 'description' | 'publisher' | 'publishYear' | 'editionTag';
const metadataFields: MetadataField[] = [
    'title', 'authors', 'isbn', 'language', 'coverUrl', 'description', 'publisher', 'publishYear', 'editionTag',
];
function sameMetadataValue(left: unknown, right: unknown): boolean {
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((value, index) => sameMetadataValue(value, right[index]));
    }
    if (typeof left === 'string' || typeof right === 'string') {
        return (typeof left === 'string' ? left.trim() : left ?? null)
            === (typeof right === 'string' ? right.trim() : right ?? null);
    }
    return (left ?? null) === (right ?? null);
}
