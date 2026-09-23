import { reactive, toRefs, onMounted } from 'vue';
import { createSettingsState, createSettingsController } from '../domain/settings';
import { zlibraryApi } from '../api/zlibraryApi';
import { doubanApi } from '../api/doubanApi';
import { aiReadingApi } from '../../ai-reading/api/aiReadingApi';
/** 作用域：设置页面实例；凭据输入只保留在本次表单中。 */
export function useSettings() {
    const state = reactive(createSettingsState());
    const controller = createSettingsController(state, zlibraryApi, doubanApi, aiReadingApi, message => window.alert(message));
    onMounted(() => { void controller.fetchConfig(); void controller.fetchDoubanConfig(); void controller.fetchAiConfig(); });
    return { ...toRefs(state), ...controller };
}
