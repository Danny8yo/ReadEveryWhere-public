import { ref, watch } from 'vue';
import { searchDoubanRatingCandidates } from '../api/metadataApi';
import type { DoubanRatingCandidate } from '../model/metadata';
import { useCommand } from '../../../shared/web/useCommand';
export type RatingValue = Pick<DoubanRatingCandidate, 'sourceBookId' | 'sourceUrl' | 'title' | 'rating' | 'ratingCount'> & {
    fetchedAt?: string;
};
export function useDoubanRating(props: {
    initialRating?: RatingValue | null;
    defaultQuery: string;
    persistSelection?: (candidate: DoubanRatingCandidate) => Promise<RatingValue>;
}, selected: (candidate: DoubanRatingCandidate) => void) {
    const rating = ref<RatingValue | null>(props.initialRating ?? null), query = ref(props.defaultQuery), showSearch = ref(false), searched = ref(false), candidates = ref<DoubanRatingCandidate[]>([]);
    const searching = useCommand(), saving = useCommand(), error = ref<string | null>(null);
    watch(() => props.initialRating, value => { rating.value = value ?? null; }, { deep: true });
    watch(() => props.defaultQuery, value => { searching.reset(); saving.reset(); candidates.value = []; searched.value = false; query.value = value; error.value = null; showSearch.value = false; });
    function openSearch() { showSearch.value = true; query.value = query.value.trim() || props.defaultQuery; error.value = null; }
    async function search() {
        if (!query.value.trim()) {
            error.value = '请输入书名';
            return;
        }
        error.value = null;
        searched.value = true;
        const result = await searching.run(() => searchDoubanRatingCandidates(query.value.trim()));
        if (result.ok)
            candidates.value = result.value;
        else if ('error' in result) {
            error.value = result.error;
            candidates.value = [];
        }
    }
    async function select(candidate: DoubanRatingCandidate) {
        error.value = null;
        const result = await saving.run(() => props.persistSelection ? props.persistSelection(candidate) : Promise.resolve(candidate));
        if (result.ok) {
            rating.value = result.value;
            selected(candidate);
            showSearch.value = false;
            candidates.value = [];
        }
        else if ('error' in result)
            error.value = result.error;
    }
    return { rating, query, showSearch, searched, candidates, error, loading: searching.busy, saving: saving.busy, openSearch, search, select };
}
