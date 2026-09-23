<template>
  <Transition name="slide-right">
    <aside
      v-if="visible"
      class="rd-panel absolute top-0 bottom-0 right-0 z-40 w-80 border-l overflow-y-auto"
    >
      <div class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="rd-label">
            书签 ({{ bookmarks.length }})
          </h3>
          <button
            class="rd-icon-btn"
            title="关闭"
            @click="$emit('close')"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>

        <div v-if="bookmarks.length === 0" class="text-sm rd-muted-text text-center py-8">
          暂无书签
        </div>

        <div
          v-for="b in bookmarks"
          :key="b.id ?? b.cfi"
          class="rd-row py-3 px-2 -mx-2"
          @click="$emit('jump-to', b)"
        >
          <div class="flex items-center gap-2">
            <span class="rd-muted-text flex-shrink-0 flex items-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M6 2a2 2 0 0 0-2 2v18l8-5.5 8 5.5V4a2 2 0 0 0-2-2z"/>
              </svg>
            </span>
            <span class="text-xs rd-body-text truncate">{{ b.chapterLabel || "未知章节" }}</span>
            <span class="ml-auto text-[10px] rd-muted-text flex-shrink-0">{{ Math.round(b.fraction * 100) }}%</span>
            <button
              class="rd-icon-btn rd-icon-btn--danger !h-6 !min-w-6 !px-1 flex-shrink-0"
              title="删除书签"
              @click.stop="b.id != null && $emit('delete', b.id)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import type { Bookmark } from "../lib/reader/bookmarks";

defineProps<{
  visible: boolean;
  bookmarks: Bookmark[];
}>();

defineEmits<{
  close: [];
  "jump-to": [bookmark: Bookmark];
  delete: [id: string];
}>();
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
