import { reactive, watch } from 'vue';

/**
 * 阅读器排版设置（全局阅读偏好，跨书、跨会话持久化）。
 *
 * 从巨石 BookReader.vue 抽出；顺带补上 localStorage 持久化——此前设置刷新即丢。
 * PDF 专属的缩放/布局仍留在组件内（与具体书籍状态相关，非全局偏好）。
 */
export interface ReaderSettings {
  fontSize: number;
  fontFamily: 'serif' | 'sans-serif' | 'system-ui';
  lineSpacing: number;
  theme: 'light' | 'dark' | 'sepia';
  justify: boolean;
  flow: 'paginated' | 'scrolled';
  /** 页边距（px） */
  margin: number;
  /** 正文最大宽度（px），控制每行长度/两侧留白 */
  maxWidth: number;
}

const STORAGE_KEY = 'readEveryWhere.readerSettings';

const DEFAULTS: ReaderSettings = {
  fontSize: 16,
  fontFamily: 'serif',
  lineSpacing: 1.5,
  theme: 'light',
  justify: true,
  flow: 'paginated',
  margin: 20,
  maxWidth: 1200,
};

function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* 损坏或不可用时回落默认 */
  }
  return { ...DEFAULTS };
}

export function useReaderSettings() {
  const settings = reactive<ReaderSettings>(loadSettings());

  watch(
    settings,
    (value) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        /* 配额超限等忽略 */
      }
    },
    { deep: true },
  );

  return { settings };
}
