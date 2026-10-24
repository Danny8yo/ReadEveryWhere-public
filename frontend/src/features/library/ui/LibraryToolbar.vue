<template>
  <div class="library-toolbar">
    <label class="library-toolbar__search">
      <UiIcon name="search" />
      <input
        type="search"
        :value="searchQuery"
        placeholder="搜索书架：书名、作者、ISBN"
        aria-label="搜索书架"
        @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
      />
    </label>
    <FormatFilterMenu
      class="library-toolbar__formats"
      :model-value="selectedFormats"
      @update:model-value="emit('update:selectedFormats', $event)"
    />
    <span class="library-toolbar__grow" />
    <span class="library-toolbar__count">{{ totalCount }} 本</span>
    <div class="library-toolbar__views" role="group" aria-label="书架视图">
      <button type="button" aria-label="封面墙" title="封面墙" :aria-pressed="viewMode === 'grid'" @click="emit('change-view', 'grid')">
        <UiIcon name="grid" :size="14" />
      </button>
      <button type="button" aria-label="列表视图" title="列表视图" :aria-pressed="viewMode === 'list'" @click="emit('change-view', 'list')">
        <UiIcon name="list" :size="14" />
      </button>
    </div>
    <UiButton v-if="viewMode === 'grid'" size="sm" icon="check" :aria-pressed="selecting" @click="emit('toggle-selecting')">
      {{ selecting ? '完成选择' : '选择' }}
    </UiButton>
    <UiButton size="sm" variant="ghost" icon="plus" @click="emit('manual-add')">手动添加</UiButton>
    <UiButton size="sm" variant="primary" icon="upload" @click="emit('import')">导入</UiButton>
  </div>

</template>

<script setup lang="ts">
import type { ViewMode } from '../model/viewMode';
import FormatFilterMenu from './FormatFilterMenu.vue';
import UiButton from '../../../shared/ui/UiButton.vue';
import UiIcon from '../../../shared/ui/UiIcon.vue';
import type { EbookFormat } from '../../../shared/utils/bookFormat';

defineProps<{
  viewMode: ViewMode;
  totalCount: number;
  searchQuery: string;
  selectedFormats: EbookFormat[];
  /** 封面墙是否处于选择模式 */
  selecting?: boolean;
}>();

const emit = defineEmits<{
  'change-view': [mode: ViewMode];
  'toggle-selecting': [];
  'manual-add': [];
  'import': [];
  'update:searchQuery': [query: string];
  'update:selectedFormats': [formats: EbookFormat[]];
}>();
</script>

<style scoped>
.library-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 0 0 20px;
}
.library-toolbar__search {
  flex: 1 1 220px;
  max-width: 320px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--ui-line);
  border-radius: 999px;
  background: var(--ui-surface);
  color: var(--ui-muted);
}
.library-toolbar__search:focus-within { border-color: var(--ui-fg); color: var(--ui-fg); }
.library-toolbar__search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ui-fg);
  font: inherit;
  font-size: 13px;
}
.library-toolbar__search input::placeholder { color: var(--ui-muted); }
.library-toolbar__formats { min-width: 0; }
.library-toolbar__grow { flex: 1 1 0; }
.library-toolbar__count { font-size: 12px; color: var(--ui-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.library-toolbar__views {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--ui-line);
  border-radius: 999px;
  background: var(--ui-surface2);
}
.library-toolbar__views button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 24px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ui-muted);
  cursor: pointer;
}
.library-toolbar__views button[aria-pressed="true"] { background: var(--ui-surface); color: var(--ui-fg); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18); }
.library-toolbar__views button:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: 1px; }

@media (max-width: 640px) {
  /* 手机：搜索独占一行，格式筛选独占一行（可横滑），按钮在第三行（设计稿踩坑记录 3.4） */
  .library-toolbar__search { flex-basis: 100%; max-width: none; order: 0; }
  .library-toolbar__formats { flex: 1 1 100%; order: 1; }
  .library-toolbar__grow, .library-toolbar__count { display: none; }
  .library-toolbar > :not(.library-toolbar__search):not(.library-toolbar__formats) { order: 2; }
}

</style>
