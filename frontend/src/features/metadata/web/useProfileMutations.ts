import { useLibraryInvalidation, withLibraryInvalidation } from '../../library/web/librarySession';
import { watch } from 'vue';
import { useCommand } from '../../../shared/web/useCommand';
import { clearBookReadingProfile, updateBookReadingProfile } from '../../library/api/libraryApi';
import { bookAnalysisApi } from '../api/bookAnalysisApi';
import type { BookReadingGenre, FormalBookReadingProfile } from '../model/bookAnalysis';
export function useProfileMutations(getBookId: () => number) {
    const invalidation=useLibraryInvalidation();
    const command = useCommand();
    watch(getBookId, command.reset);
    const save = (input: {
        primaryGenre: BookReadingGenre | null;
        secondaryGenres: BookReadingGenre[];
        classificationSummary: string | null;
    }) => command.run(() => withLibraryInvalidation(invalidation,updateBookReadingProfile)(getBookId(), input));
    const clear = () => command.run(() => withLibraryInvalidation(invalidation,clearBookReadingProfile)(getBookId()));
    const apply = (candidateId: string, override: boolean) => command.run(async () => {
        const result = await withLibraryInvalidation(invalidation,bookAnalysisApi.applyCandidate)(getBookId(), candidateId, override);
        if (typeof result !== 'object' || result === null || !('profile' in result) || !result.profile)
            throw new Error('AI 候选应用响应缺少画像');
        return result.profile as FormalBookReadingProfile;
    });
    return { saving: command.busy, error: command.error, save, clear, apply };
}
