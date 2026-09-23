import { ref, watch } from 'vue';
import { scrapeMetadata } from '../api/metadataApi';
import type { MatchedMetadataCandidate, MetadataProvider } from '../model/metadata';
import { useCommand } from '../../../shared/web/useCommand';
export function useSingleMetadata(getBookId: () => number | null) {
    const command = useCommand();
    const results = ref<MatchedMetadataCandidate[]>([]);
    const searchDone = ref(false);
    watch(getBookId, () => { command.reset(); results.value = []; searchDone.value = false; });
    async function search(provider: MetadataProvider, keyword: string) {
        const bookId = getBookId();
        if (bookId === null)
            throw new Error('刮削缺少书籍 ID');
        results.value = [];
        searchDone.value = false;
        const result = await command.run(() => scrapeMetadata(provider === 'AI' ? { provider, bookId } : { provider, bookId, keyword: keyword.trim() }));
        if (result.ok) {
            results.value = result.value;
            searchDone.value = true;
        }
        else if ('error' in result)
            searchDone.value = true;
    }
    return { results, searchDone, isSearching: command.busy, error: command.error, search };
}
