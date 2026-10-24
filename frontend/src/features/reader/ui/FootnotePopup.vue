<template>
  <Teleport to="body">
    <Transition name="footnote-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-(--ui-z-dropdown)"
        :class="skinClass"
        @pointerdown.self="$emit('close')"
      >
        <div
          ref="popupEl"
          class="footnote-popup fixed w-[min(360px,calc(100vw-16px))] max-h-[45vh] overflow-y-auto"
          :style="{ left: `${pos.x}px`, top: `${pos.y}px`, visibility: ready ? 'visible' : 'hidden' }"
          @pointerdown.stop
        >
          <div class="footnote-head flex items-center justify-between px-3 pt-2.5 pb-1.5">
            <span class="footnote-kind">
              {{ typeLabel }}
            </span>
            <button class="footnote-close" aria-label="关闭" @click="$emit('close')">
              <UiIcon name="close" :size="14" />
            </button>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -- 内容已经 sanitizeFootnoteHtml 净化 -->
          <div class="footnote-content px-3.5 py-3 text-sm leading-relaxed" v-html="safeHtml" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { FootnoteKind, ViewportRect } from '../domain/ReaderPort';
import UiIcon from '../../../shared/ui/UiIcon.vue';

import { sanitizeFootnoteHtml, computePopupPosition } from '../web/footnotePopup';

const props = defineProps<{
  visible: boolean;
  html: string;
  type: FootnoteKind | null;
  anchorRect: ViewportRect | null;
  /** 阅读主题对应的 .rd-skin-* 类（浮层 Teleport 在 .book-reader 之外） */
  skinClass?: string;
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
  color: var(--ui-info);
  text-decoration: underline;
}
.footnote-popup {
  background: var(--ui-surface);
  color: var(--ui-fg);
  border: 1px solid var(--ui-line);
  border-radius: 16px;
  box-shadow: 0 24px 50px -18px var(--ui-shadow);
  font-family: var(--ui-font-sans);
}
.footnote-head { border-bottom: 1px solid var(--ui-line); }
.footnote-kind { font-size: 11px; font-weight: 700; color: var(--ui-muted); }
.footnote-close {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  margin-right: -4px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ui-muted);
  cursor: pointer;
}
.footnote-close:hover { background: var(--ui-surface2); color: var(--ui-fg); }
</style>
