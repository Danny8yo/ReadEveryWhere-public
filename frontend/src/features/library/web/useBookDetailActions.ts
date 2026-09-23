import { useLibraryInvalidation, withLibraryInvalidation } from './librarySession';
import { ref, watch } from 'vue';
import type { BookDetailModel } from '../../../shared/model/bookDetail';
import type { DoubanRatingCandidate } from '../../metadata/model/metadata';
import { saveBookDoubanRating } from '../../metadata/api/metadataApi';
import { zlibraryApi } from '../../settings/api/zlibraryApi';
import { useCommand } from '../../../shared/web/useCommand';
export function useBookDetailActions(props: {
    isOpen: boolean;
    mode: 'search' | 'library';
    book: BookDetailModel | null;
    libraryBookId?: number;
}, selected: (id: string, rating: DoubanRatingCandidate) => void) {
    const invalidation=useLibraryInvalidation();
    const zlibraryBaseUrl = ref<string | null>(null);
    const config = useCommand();
    watch(() => props.isOpen, async (open) => {
        config.reset();
        if (open && props.mode === 'search') {
            const result = await config.run(() => zlibraryApi.getConfig());
            if (result.ok)
                zlibraryBaseUrl.value = result.value.baseUrl;
        }
    }, { immediate: true });
    async function persistDoubanSelection(candidate: DoubanRatingCandidate) {
        const bookId = props.libraryBookId, book = props.book;
        if (!bookId || !book)
            throw new Error('缺少书架书籍 ID');
        const saved = await withLibraryInvalidation(invalidation,saveBookDoubanRating)(bookId, candidate);
        const rating = { ...candidate, title: saved.sourceTitle, rating: saved.rating, ratingCount: saved.ratingCount, fetchedAt: saved.fetchedAt };
        if (props.book?.id === book.id)
            selected(book.id, rating);
        return rating;
    }
    return { zlibraryBaseUrl, detailError: config.error, persistDoubanSelection };
}
