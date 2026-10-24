<template><div class="reader-markdown" v-html="html" @click="click" /></template>
<script setup lang="ts">
import { computed } from 'vue';
import sanitizeHtml from 'sanitize-html';
import { markdown } from '../domain/markdown';
const props = withDefaults(defineProps<{ text: string; citationIds?: string[]; citationSourceTitle?: string; disabled?: boolean }>(), { citationIds: () => [], disabled: false });
const emit = defineEmits<{ citation: [id: string] }>();
const html = computed(() => sanitizeHtml(markdown.render(props.text, { citationIds: props.citationIds, citationSourceTitle: props.citationSourceTitle, disabled: props.disabled }), {
  allowedTags: ['p','br','strong','em','s','blockquote','ul','ol','li','pre','code','h1','h2','h3','h4','h5','h6','hr','table','thead','tbody','tr','th','td','button'],
  allowedAttributes: { ol: ['start'], button: ['type','data-qa-citation','data-testid','aria-label','disabled'] },
}));
function click(event: MouseEvent) {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-qa-citation]');
  if (button && !props.disabled && props.citationIds.includes(button.dataset.qaCitation!)) emit('citation', button.dataset.qaCitation!);
}
</script>
<style scoped>
.reader-markdown { white-space: normal; overflow-wrap: anywhere; line-height: 1.75; user-select: text; }
.reader-markdown :deep(p) { margin: .65em 0; }
.reader-markdown :deep(p:first-child) { margin-top: 0; }
.reader-markdown :deep(p:last-child) { margin-bottom: 0; }
.reader-markdown :deep(strong) { font-weight: 700; }
.reader-markdown :deep(em) { font-style: italic; }
.reader-markdown :deep(ul) { list-style: disc; padding-left: 1.5em; margin: .6em 0; }
.reader-markdown :deep(ol) { list-style: decimal; padding-left: 1.5em; margin: .6em 0; }
.reader-markdown :deep(li) { margin: .3em 0; }
.reader-markdown :deep(h1), .reader-markdown :deep(h2), .reader-markdown :deep(h3), .reader-markdown :deep(h4) { font-size: 1.08em; font-weight: 700; margin: 1em 0 .4em; }
.reader-markdown :deep(blockquote) { border-left: 3px solid var(--ui-line); padding-left: .8em; opacity: .85; }
.reader-markdown :deep(pre) { white-space: pre-wrap; background: var(--ui-surface2); padding: .8em; border-radius: 6px; }
.reader-markdown :deep(code) { font-family: monospace; background: var(--ui-surface2); }
.reader-markdown :deep(table) { display: block; overflow-x: auto; border-collapse: collapse; }
.reader-markdown :deep(th), .reader-markdown :deep(td) { padding: .4em; border: 1px solid var(--ui-line); }
.reader-markdown :deep(button) { color: var(--ui-info); border: 0; padding: 0 .2em; cursor: pointer; }
</style>
