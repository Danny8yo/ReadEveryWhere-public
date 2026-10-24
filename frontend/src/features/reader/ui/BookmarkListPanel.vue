<template>
  <Transition name="slide-right">
    <aside
      v-if="visible"
      class="rd-panel absolute top-0 bottom-0 right-0 z-(--ui-z-dropdown) w-80 max-w-full border-l overflow-y-auto"
    >
      <div class="p-5">
        <div class="rd-panel__head">
          <h3 class="rd-panel__title">书签<small>{{ bookmarks.length }}</small></h3>
          <button class="rd-ib" title="关闭" @click="$emit('close')"><UiIcon name="close" :size="16" /></button>
        </div>

        <div v-if="bookmarks.length === 0" class="rd-empty">
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
              <UiIcon name="bookmark" :size="14" />
            </span>
            <span class="text-xs rd-body-text truncate">{{ b.chapterLabel || "未知章节" }}</span>
            <span class="ml-auto text-[11px] rd-muted-text flex-shrink-0">{{ Math.round(b.fraction * 100) }}%</span>
            <button
              class="rd-ib rd-ib--danger !h-7 !min-w-7 flex-shrink-0"
              title="删除书签"
              @click.stop="b.id != null && $emit('delete', b.id)"
            >
              <UiIcon name="close" :size="13" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import UiIcon from "../../../shared/ui/UiIcon.vue";
import type { Bookmark } from "../model/bookmark";

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
