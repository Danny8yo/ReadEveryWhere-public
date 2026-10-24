<template>
  <Transition name="slide-right">
    <aside
      v-if="visible"
      class="rd-panel absolute top-0 bottom-0 right-0 z-(--ui-z-dropdown) w-80 max-w-full border-l overflow-y-auto flex flex-col"
    >
      <div class="p-5 flex flex-col gap-4 h-full">
        <div class="rd-panel__head !mb-0">
          <h3 class="rd-panel__title">全文搜索</h3>
          <button class="rd-ib" title="关闭" @click="$emit('close')"><UiIcon name="close" :size="16" /></button>
        </div>

        <!-- 输入框 -->
        <div class="relative">
          <span class="absolute left-2.5 top-1/2 -translate-y-1/2 rd-muted-text pointer-events-none">
            <UiIcon name="search" :size="14" />
          </span>
          <input
            ref="inputEl"
            v-model="query"
            type="search"
            placeholder="搜索书中内容…"
            class="ui-input !pl-8 !pr-9"
            @input="onInput"
            @keydown.enter.prevent="onEnter"
          />
          <button
            v-if="query"
            class="absolute right-2 top-1/2 -translate-y-1/2 rd-ib !h-7 !min-w-7"
            title="清空"
            @click="clearQuery"
          >
            <UiIcon name="close" :size="14" />
          </button>
        </div>

        <!-- 结果区（搜索中也实时显示已找到的结果 + 进度） -->
        <div class="flex-1 overflow-y-auto -mx-2">
          <template v-if="results.length > 0">
            <p class="px-2 text-[11px] rd-muted-text mb-1">
              共 {{ results.length }} 条结果<span v-if="searching">（搜索中 {{ pct }}%）</span>
            </p>
            <div
              v-for="group in groups"
              :key="group.chapter"
              class="mb-3"
            >
              <div class="rd-group-head px-2 py-1.5 text-[11px] font-bold sticky top-0 rounded-lg">
                {{ group.chapter }} ({{ group.items.length }})
              </div>
              <button
                v-for="(item, i) in group.items"
                :key="item.cfi + ':' + i"
                type="button"
                class="rd-row block w-full text-left py-2.5 px-2"
                @click="$emit('jump-to', item)"
              >
                <span class="text-xs rd-body-text leading-relaxed line-clamp-3">
                  <template v-for="(seg, si) in highlightSegments(item.excerpt)" :key="si">
                    <mark v-if="seg.match" class="rd-mark rounded-sm px-0.5">{{ seg.text }}</mark>
                    <template v-else>{{ seg.text }}</template>
                  </template>
                </span>
              </button>
            </div>
          </template>
          <div v-else-if="searching" class="rd-empty">
            搜索中 {{ pct }}%…
          </div>
          <div v-else-if="hasSearched" class="rd-empty">
            无匹配
          </div>
          <div v-else class="rd-empty">
            输入关键词开始搜索
          </div>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import UiIcon from "../../../shared/ui/UiIcon.vue";
import { ref, computed, watch, nextTick } from 'vue';
import { groupResultsByChapter, type SearchResultItem } from '../domain/searchResults';

const props = defineProps<{
  visible: boolean;
  results: SearchResultItem[];
  searching: boolean;
  hasSearched: boolean;
  progress?: number;
}>();

const pct = computed(() => Math.round((props.progress ?? 0) * 100));

const emit = defineEmits<{
  search: [query: string];
  'jump-to': [item: SearchResultItem];
  close: [];
}>();

const query = ref('');
const inputEl = ref<HTMLInputElement>();
let debounceTimer: number | null = null;

const groups = computed(() => groupResultsByChapter(props.results));

// 面板打开时自动聚焦输入框
watch(
  () => props.visible,
  (open) => {
    if (open) nextTick(() => inputEl.value?.focus());
  },
);

function fire(immediate = false) {
  if (debounceTimer !== null) {
    window.clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  const run = () => emit('search', query.value.trim());
  if (immediate) run();
  else debounceTimer = window.setTimeout(run, 300);
}

function onInput() {
  // 清空时立即触发（快速清结果）；否则 debounce
  fire(query.value.trim() === '');
}

function onEnter() {
  fire(true);
}

function clearQuery() {
  query.value = '';
  fire(true);
  inputEl.value?.focus();
}

// 把 excerpt 按 query 大小写不敏感切段，供模板高亮匹配词（不用 v-html，避免 XSS）
function highlightSegments(excerpt: string): { text: string; match: boolean }[] {
  const q = query.value.trim();
  if (!q) return [{ text: excerpt, match: false }];
  const lowerText = excerpt.toLowerCase();
  const lowerQ = q.toLowerCase();
  const segments: { text: string; match: boolean }[] = [];
  let from = 0;
  let idx = lowerText.indexOf(lowerQ, from);
  while (idx !== -1) {
    if (idx > from) segments.push({ text: excerpt.slice(from, idx), match: false });
    segments.push({ text: excerpt.slice(idx, idx + q.length), match: true });
    from = idx + q.length;
    idx = lowerText.indexOf(lowerQ, from);
  }
  if (from < excerpt.length) segments.push({ text: excerpt.slice(from), match: false });
  return segments;
}
</script>

<style scoped>
.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}
</style>
