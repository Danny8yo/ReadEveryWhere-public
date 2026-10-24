import { ref } from 'vue';

/**
 * 阅读器界面显隐状态（顶/底栏、左侧目录、右侧设置、批注列表）。
 * 从 BookReader.vue 抽出，供键盘/手势/按钮多入口统一切换。
 */
export function useReaderUI() {
  const uiVisible = ref(true);
  const sidebarOpen = ref(false);
  const settingsOpen = ref(false);
  const annotationListOpen = ref(false);

  function toggleUI() {
    uiVisible.value = !uiVisible.value;
  }

  return { uiVisible, sidebarOpen, settingsOpen, annotationListOpen, toggleUI };
}
