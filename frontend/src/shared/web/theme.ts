// 应用外壳主题（与阅读器自己的“明亮/暗黑/羊皮”阅读主题无关）。
// 结果写到 <html data-theme="light|dark">，styles.css 按它切换 --ui-* 变量。
import { readonly, ref } from 'vue';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'readEveryWhere.theme';

/** 默认跟随系统；用户可在“设置 → 外观”改为固定浅色或深色（P7 起开放，之前过渡期固定浅色） */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

export function parseThemePreference(value: unknown): ThemePreference {
    return value === 'system' || value === 'light' || value === 'dark' ? value : DEFAULT_THEME_PREFERENCE;
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
    if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
    return preference;
}

const preference = ref<ThemePreference>(DEFAULT_THEME_PREFERENCE);
const resolved = ref<ResolvedTheme>('light');
let media: MediaQueryList | null = null;

function readStored(): ThemePreference {
    try {
        return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
        return DEFAULT_THEME_PREFERENCE;
    }
}

function apply() {
    resolved.value = resolveTheme(preference.value, media?.matches ?? false);
    document.documentElement.dataset.theme = resolved.value;
}

/** 在 main.ts 挂载应用前调用一次 */
export function installTheme() {
    preference.value = readStored();
    media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    media?.addEventListener?.('change', apply);
    apply();
}

export function useTheme() {
    return {
        preference: readonly(preference),
        theme: readonly(resolved),
        setPreference(next: ThemePreference) {
            preference.value = next;
            try {
                localStorage.setItem(THEME_STORAGE_KEY, next);
            } catch {
                // 存储不可用时本次会话仍然生效
            }
            apply();
        },
    };
}
