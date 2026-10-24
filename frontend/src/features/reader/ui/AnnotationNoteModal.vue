<template>
  <!-- UiOverlay 负责 Teleport、背景 inert、焦点进出和 Esc；配色跟随阅读主题（skinClass） -->
  <UiOverlay
    :open="visible"
    kind="modal"
    width="760px"
    labelledby="annotation-note-title"
    test-id="annotation-note-dialog"
    :root-class="skinClass"
    panel-class="note-dialog"
    @close="emit('cancel')"
  >
    <header class="note-header">
      <h2 id="annotation-note-title">批注笔记</h2>
      <UiButton variant="ghost" size="sm" icon="close" aria-label="关闭批注" @click="emit('cancel')">关闭</UiButton>
    </header>
    <p v-if="notice" role="alert" class="note-notice">{{ notice }}</p>
    <label v-if="annotationOptions && annotationOptions.length > 1" class="note-picker">
      此处有 {{ annotationOptions.length }} 条批注
      <select class="ui-input" aria-label="切换笔记" :value="activeId" :disabled="dirty" @change="emit('select-annotation', ($event.target as HTMLSelectElement).value)">
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
    <textarea v-else ref="textareaRef" data-autofocus v-model="noteText" class="note-content note-editor" aria-label="编辑笔记" placeholder="写下你的想法，支持 Markdown…" />
    <footer class="note-footer">
      <template v-if="editing || dirty">
        <UiButton @click="reset">取消修改</UiButton>
        <UiButton variant="primary" @click="emit('save', noteText)">保存</UiButton>
      </template>
      <UiButton v-else variant="primary" @click="emit('cancel')">完成</UiButton>
    </footer>
  </UiOverlay>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import MarkdownContent from '../../../shared/ui/MarkdownContent.vue';
import UiOverlay from '../../../shared/ui/UiOverlay.vue';
import UiButton from '../../../shared/ui/UiButton.vue';
const props = defineProps<{ visible: boolean; selectedText: string; initialNote?: string | null; activeId?: string; annotationOptions?: Array<{ id: string; label: string }>; skinClass?: string; notice?: string }>();
const emit = defineEmits<{ save: [note: string]; cancel: []; 'select-annotation': [id: string] }>();
const noteText = ref(''), editing = ref(false);
const textareaRef = ref<HTMLTextAreaElement>();
const dirty = computed(() => noteText.value !== (props.initialNote ?? ''));
function edit() { editing.value = true; void nextTick(() => textareaRef.value?.focus()); }
function reset() { noteText.value = props.initialNote ?? ''; editing.value = false; }
watch(() => [props.visible, props.activeId, props.initialNote] as const, ([visible]) => {
  if (!visible) return;
  noteText.value = props.initialNote ?? '';
  editing.value = !props.initialNote;
}, { immediate: true });
</script>
<style scoped>
/* 固定高度：长笔记在正文框里滚动，不把弹窗撑出视口 */
:global(.note-dialog) { height: min(760px, 88dvh); display: flex; flex-direction: column; padding: 22px 24px; }
.note-header, .note-tabs, .note-footer { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.note-header { justify-content: space-between; margin-bottom: 14px; }
.note-header h2 { margin: 0; font-size: 18px; font-weight: 900; }
.note-notice { margin: 0 0 12px; padding: 10px 14px; border-radius: var(--ui-radius-control); background: color-mix(in srgb, var(--ui-warn) 14%, var(--ui-surface)); font-size: 13px; flex-shrink: 0; }
.note-picker { display: grid; gap: 6px; font-size: 12px; color: var(--ui-muted); margin-bottom: 12px; flex-shrink: 0; }
.note-picker select { min-height: 38px; padding: 7px 10px; }
.note-quote { font-size: 13px; color: var(--ui-fg2); border-left: 3px solid var(--ui-line); padding: 8px 12px; margin-bottom: 14px; flex-shrink: 0; }
.note-quote summary { cursor: pointer; overflow-wrap: anywhere; }
.note-quote blockquote { max-height: 100px; overflow: auto; white-space: pre-wrap; margin: 8px 0 0; }
.note-tabs { margin-bottom: 10px; }
.note-tabs button { border: 1px solid var(--ui-line); border-radius: 999px; padding: 5px 14px; background: transparent; color: var(--ui-muted); font: inherit; font-size: 12px; cursor: pointer; }
.note-tabs button[aria-pressed="true"] { background: var(--ui-strong); color: var(--ui-on-strong); border-color: transparent; font-weight: 700; }
.note-tabs button:focus-visible, .note-content:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: 2px; }
.note-tabs span { margin-left: auto; font-size: 12px; color: var(--ui-muted); }
.note-content { flex: 1; min-height: 0; overflow: auto; padding: 16px; border: 1px solid var(--ui-line); border-radius: 12px; background: var(--ui-surface); color: var(--ui-fg); font-size: 16px; line-height: 1.8; overflow-wrap: anywhere; }
.note-editor { width: 100%; resize: none; font: inherit; font-size: 16px; }
.note-empty { color: var(--ui-muted); }
.note-footer { justify-content: flex-end; margin-top: 14px; }
@media (max-width: 640px) { :global(.note-dialog) { height: calc(100dvh - 40px); padding: 16px; } .note-tabs span { font-size: 11px; } }
</style>
