<template>
  <Teleport to="body">
    <Transition name="footnote-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-[110]"
        @pointerdown.self="$emit('close')"
      >
        <div
          ref="popupEl"
          class="fixed w-[min(360px,calc(100vw-16px))] max-h-[45vh] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-2xl"
          :style="{ left: `${pos.x}px`, top: `${pos.y}px`, visibility: ready ? 'visible' : 'hidden' }"
          @pointerdown.stop
        >
          <div class="flex items-center justify-between px-3 pt-2.5 pb-1.5 border-b border-gray-100">
            <span class="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              {{ typeLabel }}
            </span>
            <button
              class="text-gray-400 hover:text-black transition-colors p-1 -mr-1"
              aria-label="关闭"
              @click="$emit('close')"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -- 内容已经 sanitizeFootnoteHtml 净化 -->
          <div class="footnote-content px-3.5 py-3 text-sm leading-relaxed text-gray-800" v-html="safeHtml" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { FootnoteKind, ViewportRect } from '../features/reader/domain/ReaderPort';

import { sanitizeFootnoteHtml, computePopupPosition } from '../lib/reader/footnotePopup';

const props = defineProps<{
  visible: boolean;
  html: string;
  type: FootnoteKind | null;
  anchorRect: ViewportRect | null;
}>();

defineEmits<{ close: [] }>();

const popupEl = ref<HTMLDivElement>();
const pos = ref({ x: 0, y: 0 });
const ready = ref(false);

const safeHtml = computed(() => sanitizeFootnoteHtml(props.html));

const TYPE_LABELS: Record<FootnoteKind, string> = {
  footnote: '脚注',
  endnote: '尾注',
  note: '注释',
  biblioentry: '参考文献',
  definition: '释义',
};
const typeLabel = computed(() => (props.type ? TYPE_LABELS[props.type] : '注释'));

// 内容/可见性变化后：等 DOM 渲染出真实尺寸，再就近定位并夹紧在视口内。
watch(
  () => [props.visible, props.html] as const,
  async () => {
    if (!props.visible) {
      ready.value = false;
      return;
    }
    ready.value = false;
    await nextTick();
    const el = popupEl.value;
    const anchor = props.anchorRect;
    if (!el || !anchor) {
      ready.value = true;
      return;
    }
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    pos.value = computePopupPosition(anchor, size, viewport);
    ready.value = true;
  },
  { immediate: true },
);
</script>

<style scoped>
.footnote-fade-enter-active,
.footnote-fade-leave-active {
  transition: opacity 0.15s ease;
}
.footnote-fade-enter-from,
.footnote-fade-leave-to {
  opacity: 0;
}
/* 脚注正文里的图片/表格不撑破浮层 */
.footnote-content :deep(img) {
  max-width: 100%;
  height: auto;
}
.footnote-content :deep(p) {
  margin: 0 0 0.5em;
}
.footnote-content :deep(p:last-child) {
  margin-bottom: 0;
}
.footnote-content :deep(a) {
  color: #2563eb;
  text-decoration: underline;
}
</style>
