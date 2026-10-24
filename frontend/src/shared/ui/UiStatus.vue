<template>
  <span class="ui-status" :class="`ui-status--${tone}`"><slot /></span>
</template>

<script setup lang="ts">
// 状态标签：小圆点 + 文字。状态色与书色无关，只表达好/坏/进行中。
withDefaults(defineProps<{ tone?: 'ok' | 'warn' | 'err' | 'info' | 'muted' }>(), { tone: 'muted' });
</script>

<style scoped>
.ui-status {
  --tone: var(--ui-muted);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--tone) 16%, transparent);
  color: var(--tone);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.ui-status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.ui-status--ok { --tone: var(--ui-ok); }
.ui-status--warn { --tone: var(--ui-warn); }
.ui-status--err { --tone: var(--ui-err); }
.ui-status--info { --tone: var(--ui-info); }
</style>
