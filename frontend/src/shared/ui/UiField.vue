<template>
  <div class="ui-field">
    <label v-if="label" class="ui-field__label" :for="forId">{{ label }}</label>
    <slot />
    <p v-if="error" class="ui-field__error" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="ui-field__hint">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
// 表单字段外壳：标签 + 控件（slot，控件上加 class="ui-input" 和与 forId 相同的 id）+ 提示或错误。
defineProps<{ label?: string; forId?: string; hint?: string | null; error?: string | null }>();
</script>

<style scoped>
.ui-field { display: grid; gap: 6px; min-width: 0; }
.ui-field__label { font-size: 12px; font-weight: 500; color: var(--ui-muted); }
.ui-field__hint, .ui-field__error { margin: 0; font-size: 12px; }
.ui-field__hint { color: var(--ui-muted); }
.ui-field__error { color: var(--ui-err); }
</style>
