<template>
  <div v-if="open" class="mobile-toc-overlay" @keydown="onKeydown">
    <button class="toc-backdrop" aria-label="关闭目录" tabindex="-1" @click="emit('close')" />
    <section ref="panel" class="mobile-toc-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-toc-title" tabindex="-1">
      <div class="toc-handle" @pointerdown="startDrag" @pointerup="finishDrag" @pointercancel="dragStart = null"><span /></div>
      <div class="toc-header">
        <button class="toc-search" @click="emit('search')"><UiIcon name="search" :size="15" />搜本书</button>
        <h2 id="mobile-toc-title">目录</h2>
        <button aria-label="关闭目录" @click="emit('close')">关闭</button>
      </div>
      <button class="toc-current" :disabled="!currentHref" @click="revealCurrent">
        <span><UiIcon name="toc" :size="15" />当前读到</span><span class="toc-current-label">{{ currentLabel || '正文' }}</span>
      </button>
      <p v-if="error" class="toc-error" role="alert">{{ error }}</p>
      <nav ref="scrollArea" class="toc-scroll" aria-label="书籍目录">
        <p v-if="!rows.length" class="toc-empty">这本书没有目录，可通过阅读进度跳转。</p>
        <div v-for="row in visibleRows" :key="row.key" class="toc-row" :class="{ 'toc-row-current': row.item.href === currentHref }" :style="{ paddingInlineStart: `${16 + Math.min(row.depth, 4) * 18}px` }">
          <button v-if="row.hasChildren" class="toc-expand" :aria-label="`${collapsed.has(row.key) ? '展开' : '收起'} ${row.item.label}`" :aria-expanded="!collapsed.has(row.key)" @click="toggle(row.key)">
            <svg viewBox="0 0 16 16" :class="{ collapsed: collapsed.has(row.key) }"><path d="m4 6 4 4 4-4" /></svg>
          </button>
          <span v-else class="toc-leaf-space" />
          <button class="toc-title" :data-toc-key="row.key" :aria-current="row.item.href === currentHref ? 'location' : undefined" :disabled="busy || (!row.item.href && !row.hasChildren)" @click="row.item.href ? emit('navigate', row.item.href) : toggle(row.key)">{{ row.item.label }}</button>
        </div>
      </nav>
      <div v-if="rows.length" class="toc-jumps" role="group" aria-label="目录滚动操作">
        <button @click="scrollToEdge('top')">↑ 去顶部</button>
        <button @click="scrollToEdge('bottom')">↓ 去底部</button>
      </div>
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { TocItem } from '../domain/ReaderPort';
import UiIcon from '../../../shared/ui/UiIcon.vue';
const props = defineProps<{ open: boolean; items: TocItem[]; currentHref: string; currentLabel: string; error: string | null; busy: boolean }>();
const emit = defineEmits<{ close: []; search: []; navigate: [href: string] }>();
const panel = ref<HTMLElement>(), scrollArea = ref<HTMLElement>();
const collapsed = ref(new Set<string>());
type Row = { key: string; item: TocItem; depth: number; parents: string[]; hasChildren: boolean };
const rows = computed(() => {
  const result: Row[] = [];
  function visit(items: TocItem[], parents: string[]) {
    items.forEach((item, index) => {
      const key = [...parents, String(index)].join('-');
      const children = item.subitems ?? [];
      result.push({ key, item, depth: parents.length, parents, hasChildren: children.length > 0 });
      visit(children, [...parents, key]);
    });
  }
  visit(props.items, []);
  return result;
});
const visibleRows = computed(() => rows.value.filter(row => !row.parents.some(key => collapsed.value.has(key))));
function toggle(key: string) {
  const next = new Set(collapsed.value);
  next.has(key) ? next.delete(key) : next.add(key);
  collapsed.value = next;
}
async function revealCurrent() {
  const row = rows.value.find(row => row.item.href === props.currentHref);
  if (!row) return;
  const next = new Set(collapsed.value);
  row.parents.forEach(key => next.delete(key));
  collapsed.value = next;
  await nextTick();
  const target = scrollArea.value?.querySelector<HTMLElement>(`[data-toc-key="${row.key}"]`);
  if (target && scrollArea.value) {
    const area = scrollArea.value;
    area.scrollTop += target.getBoundingClientRect().top - area.getBoundingClientRect().top - area.clientHeight / 2 + target.clientHeight / 2;
  }
}
function scrollToEdge(edge: 'top' | 'bottom') {
  if (scrollArea.value) scrollArea.value.scrollTop = edge === 'top' ? 0 : scrollArea.value.scrollHeight;
}
let returnFocus: HTMLElement | null = null;
watch(() => props.open, async open => {
  if (!window.matchMedia('(max-width: 767px)').matches) return;
  if (open) {
    returnFocus = document.activeElement as HTMLElement;
    await nextTick();
    if (!props.open) return;
    panel.value?.focus({ preventScroll: true });
    await revealCurrent();
  } else returnFocus?.focus({ preventScroll: true });
});
watch(() => props.items, () => { collapsed.value = new Set(); });
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.stopPropagation(); emit('close'); }
  if (event.key !== 'Tab' || !panel.value) return;
  const buttons = [...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled)')];
  const first = buttons[0], last = buttons.at(-1);
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
let dragStart: number | null = null;
function startDrag(event: PointerEvent) {
  dragStart = event.clientY;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function finishDrag(event: PointerEvent) {
  if (dragStart !== null && event.clientY - dragStart > 60) emit('close');
  dragStart = null;
}
</script>
<style scoped>
.mobile-toc-overlay { display: none; }
@media (max-width: 767px) {
  .mobile-toc-overlay { display: block; position: absolute; inset: 0 0 var(--rd-bar-bottom, 0px); z-index: var(--ui-z-dropdown); }
  .toc-backdrop { position: absolute; inset: 0; width: 100%; background: var(--ui-scrim); border: 0; }
  .mobile-toc-sheet { position: absolute; inset: max(24px, 5dvh) 0 0; display: flex; flex-direction: column; overflow: hidden; border-radius: 24px 24px 0 0; background: var(--ui-surface); color: var(--ui-fg); box-shadow: 0 -18px 40px -18px var(--ui-shadow); font-family: var(--ui-font-sans); padding-bottom: env(safe-area-inset-bottom, 0px); }
  button { font: inherit; color: inherit; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: -3px; }
  button:disabled { opacity: .5; cursor: default; }
  .toc-handle { display: grid; place-items: center; height: 28px; flex-shrink: 0; touch-action: none; }
  .toc-handle span { width: 42px; height: 4px; border-radius: 4px; background: var(--ui-muted); opacity: .4; }
  .toc-header { display: flex; align-items: center; justify-content: space-between; padding: 0 18px 8px; gap: 12px; border-bottom: 1px solid var(--ui-line); }
  .toc-header h2 { font-size: 17px; font-weight: 900; margin: 0; }
  .toc-header button { min-height: 44px; border: 0; background: transparent; font-size: 14px; }
  .toc-header .toc-search { display: inline-flex; align-items: center; gap: 6px; color: var(--ui-muted); }
  .toc-current { display: flex; align-items: center; gap: 12px; text-align: left; padding: 16px 24px; background: var(--ui-surface2); border: 0; color: var(--ui-fg); min-height: 60px; flex-shrink: 0; }
  .toc-current > span:first-child { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-weight: 700; }
  .toc-current-label { color: var(--ui-muted); }
  .toc-current-label { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .toc-scroll { min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 0 12px; }
  .toc-row { display: flex; align-items: center; border-bottom: 1px solid var(--ui-line); }
  .toc-expand { width: 44px; min-height: 60px; flex-shrink: 0; display: grid; place-items: center; background: transparent; border: 0; }
  .toc-expand svg { width: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; }
  .toc-expand svg.collapsed { transform: rotate(-90deg); }
  .toc-leaf-space { width: 12px; flex-shrink: 0; }
  .toc-title { flex: 1; min-width: 0; text-align: left; padding: 18px 12px 18px 0; font-size: 17px; line-height: 1.55; overflow-wrap: anywhere; background: transparent; border: 0; min-height: 64px; }
  .toc-row-current { color: var(--ui-fg); background: var(--ui-surface2); border-radius: 10px; }
  .toc-row-current .toc-title { font-weight: 700; }
  .toc-jumps { display: flex; justify-content: center; gap: 16px; padding: 10px 16px; border-top: 1px solid var(--ui-line); }
  .toc-jumps button { border: 1px solid var(--ui-line); border-radius: 999px; padding: 10px 20px; background: var(--ui-surface2); font-size: 14px; min-height: 44px; }
  .toc-error { margin: 8px 24px; color: var(--ui-err); font-size: 13px; }
  .toc-empty { margin: 24px; color: var(--ui-muted); font-size: 14px; }
}
</style>
