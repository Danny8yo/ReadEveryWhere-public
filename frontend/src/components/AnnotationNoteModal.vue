<template>
  <Teleport to="body">
    <div v-if="visible" class="note-backdrop" @click.self="emit('cancel')" @keydown="onKeydown">
      <section ref="dialog" :style="themeStyle" class="note-dialog" role="dialog" aria-modal="true" aria-labelledby="annotation-note-title" data-testid="annotation-note-dialog" tabindex="-1">
        <header class="note-header">
          <h2 id="annotation-note-title">批注笔记</h2>
          <button aria-label="关闭批注" @click="emit('cancel')">关闭</button>
        </header>
        <label v-if="annotationOptions && annotationOptions.length > 1" class="note-picker">
          此处有 {{ annotationOptions.length }} 条批注
          <select aria-label="切换笔记" :value="activeId" :disabled="dirty" @change="emit('select-annotation', ($event.target as HTMLSelectElement).value)">
            <option v-for="item in annotationOptions" :key="item.id" :value="item.id">{{ item.label }}</option>
          </select>
          <span v-if="dirty">请先保存或取消修改，再切换笔记。</span>
        </label>
        <details class="note-quote"><summary>原文 · {{ selectedText.slice(0, 60) }}{{ selectedText.length > 60 ? '…' : '' }}</summary><blockquote>{{ selectedText }}</blockquote></details>
        <div class="note-tabs" aria-label="笔记显示方式">
          <button :aria-pressed="!editing" @click="editing = false">阅读</button>
          <button :aria-pressed="editing" @click="edit">编辑</button>
          <span>{{ noteText.length }} 字符</span>
        </div>
        <div v-if="!editing" :key="activeId" class="note-content" tabindex="0" aria-label="笔记全文">
          <MarkdownContent v-if="noteText" :text="noteText" />
          <p v-else class="note-empty">还没有笔记，点击“编辑”写下你的想法。</p>
        </div>
        <textarea v-else ref="textareaRef" v-model="noteText" class="note-content note-editor" aria-label="编辑笔记" placeholder="写下你的想法，支持 Markdown…" />
        <footer class="note-footer">
          <template v-if="editing || dirty">
            <button @click="reset">取消修改</button>
            <button class="note-save" @click="emit('save', noteText)">保存</button>
          </template>
          <button v-else @click="emit('cancel')">完成</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import MarkdownContent from './MarkdownContent.vue';
const props = defineProps<{ visible: boolean; selectedText: string; initialNote?: string | null; activeId?: string; annotationOptions?: Array<{ id: string; label: string }> }>();
const emit = defineEmits<{ save: [note: string]; cancel: []; 'select-annotation': [id: string] }>();
const noteText = ref(''), editing = ref(false);
const themeStyle = ref<Record<string, string>>({});
const dialog = ref<HTMLElement>(), textareaRef = ref<HTMLTextAreaElement>();
const dirty = computed(() => noteText.value !== (props.initialNote ?? ''));
let returnFocus: HTMLElement | null = null;
function edit() { editing.value = true; void nextTick(() => textareaRef.value?.focus()); }
function reset() { noteText.value = props.initialNote ?? ''; editing.value = false; void nextTick(() => dialog.value?.focus()); }
watch(() => [props.visible, props.activeId, props.initialNote] as const, ([visible], old) => {
  if (!visible) { if (old?.[0]) returnFocus?.focus(); return; }
  if (!old?.[0]) returnFocus = document.activeElement as HTMLElement;
  const reader = document.querySelector('.book-reader');
  if (reader) { const style = getComputedStyle(reader); themeStyle.value = Object.fromEntries(['--rd-surface-solid','--rd-fg','--rd-border','--rd-accent','--rd-chip-bg'].map(key => [key, style.getPropertyValue(key)])); }
  noteText.value = props.initialNote ?? '';
  editing.value = !props.initialNote;
  void nextTick(() => (editing.value ? textareaRef.value : dialog.value)?.focus());
}, { immediate: true });
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.stopPropagation(); emit('cancel'); }
  if (event.key !== 'Tab' || !dialog.value) return;
  const items = [...dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), textarea, summary, [tabindex="0"]')];
  const first = items[0], last = items.at(-1);
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
</script>
<style scoped>
.note-backdrop { position: fixed; inset: 0; z-index: 110; display: flex; align-items: center; justify-content: center; background: #0006; padding: 16px; }
.note-dialog { width: 760px; max-width: 100%; height: min(760px, 88dvh); display: flex; flex-direction: column; background: var(--rd-surface-solid, #fff); color: var(--rd-fg, #27272a); border: 1px solid var(--rd-border, #ddd); border-radius: 16px; padding: 24px; box-shadow: 0 20px 70px #0004; }
.note-header, .note-tabs, .note-footer { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.note-header { justify-content: space-between; margin-bottom: 16px; }
.note-header h2 { font-size: 18px; font-weight: 600; }
button { border: 1px solid var(--rd-border, #ddd); padding: 7px 14px; border-radius: 7px; cursor: pointer; }
button:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--rd-accent, #92743e); outline-offset: 2px; }
.note-picker { display: block; font-size: 13px; margin-bottom: 12px; }
.note-picker select { display: block; width: 100%; margin: 6px 0; padding: 8px; border: 1px solid var(--rd-border, #ddd); border-radius: 6px; background: inherit; }
.note-picker span, .note-empty { opacity: .7; }
.note-quote { font-size: 13px; border-left: 3px solid var(--rd-accent, #c4a25e); padding: 8px 12px; margin-bottom: 16px; flex-shrink: 0; }
.note-quote summary { cursor: pointer; overflow-wrap: anywhere; }
.note-quote blockquote { max-height: 100px; overflow: auto; white-space: pre-wrap; margin-top: 8px; }
.note-tabs { margin-bottom: 12px; }
.note-tabs button[aria-pressed="true"] { background: var(--rd-chip-bg, #eee); font-weight: 600; }
.note-tabs span { margin-left: auto; font-size: 12px; opacity: .6; }
.note-content { flex: 1; min-height: 0; overflow: auto; padding: 16px; border: 1px solid var(--rd-border, #ddd); border-radius: 8px; font-size: 16px; line-height: 1.8; overflow-wrap: anywhere; }
.note-editor { width: 100%; resize: none; background: transparent; color: inherit; }
.note-footer { justify-content: flex-end; margin-top: 16px; }
.note-save { background: var(--rd-accent, #5c4b32); color: white; }
@media(max-width: 600px) { .note-backdrop { padding: 8px; } .note-dialog { height: 94dvh; padding: 16px; border-radius: 10px; } .note-tabs span { font-size: 10px; } }
</style>
