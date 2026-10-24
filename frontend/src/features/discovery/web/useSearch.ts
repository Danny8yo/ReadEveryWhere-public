import { randomId } from '../../../shared/web/randomId';
import { reactive, toRefs, computed } from 'vue';
import { createSearchState, createSearchController } from '../domain/search';
import { searchBooksRemote } from '../api/searchApi';
/** 作用域：应用登录会话；tab 切换保留搜索，退出登录清空。 */
const state = reactive(createSearchState());
const controller = createSearchController(state, searchBooksRemote, () => randomId());
if (typeof window !== 'undefined')
    window.addEventListener('auth:session-cleared', controller.clearSearch);
export function useSearch() { return { ...toRefs(state), ...controller, hasResults: computed(() => state.results.length > 0) }; }
