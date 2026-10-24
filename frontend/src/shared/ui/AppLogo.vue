<template>
  <span class="app-logo">
    <span class="app-logo__mark" aria-hidden="true"><i /><i /><i /></span>
    <span class="app-logo__name">随身看</span>
  </span>
</template>

<script setup lang="ts">
// 品牌标识：三本高低不一的书 + 名称。三种颜色是固定的品牌色，不随主题变化。
</script>

<style scoped>
.app-logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 900;
  font-size: 17px;
  color: var(--ui-fg);
  white-space: nowrap;
}
.app-logo__mark { display: inline-flex; align-items: flex-end; gap: 2px; height: 18px; }
.app-logo__mark i { width: 5px; border-radius: 1px; }
.app-logo__mark i:nth-child(1) { height: 12px; background: #c4652b; }
.app-logo__mark i:nth-child(2) { height: 18px; background: #2d6fa8; }
.app-logo__mark i:nth-child(3) { height: 14px; background: #a9262c; }
</style>
