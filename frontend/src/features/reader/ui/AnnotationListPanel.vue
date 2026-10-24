<template>
  <Transition name="slide-right">
    <aside
      v-if="visible"
      class="rd-panel absolute top-0 bottom-0 right-0 z-(--ui-z-dropdown) w-80 max-w-full border-l overflow-y-auto"
    >
      <div class="p-5">
        <div class="rd-panel__head">
          <h3 class="rd-panel__title">批注<small>{{ annotations.length }}</small></h3>
          <button class="rd-ib" title="关闭" @click="$emit('close')"><UiIcon name="close" :size="16" /></button>
        </div>

        <div v-if="annotations.length === 0" class="rd-empty">
          暂无批注
        </div>

        <div
          v-for="a in annotations"
          :key="a.id"
          class="rd-row py-3 px-2 -mx-2"
          @click="$emit('jump-to', a)"
        >
          <div class="flex items-center gap-2 mb-1.5">
            <span v-if="a.annotationType === 'highlight'" class="w-4 h-1 rounded-sm flex-shrink-0" :style="{ background: a.color }" />
            <span v-else-if="a.annotationType === 'underline'" class="w-4 border-b-2 flex-shrink-0" :style="{ borderColor: a.color }" />
            <span v-else class="w-4 flex-shrink-0 flex items-center">
              <svg width="16" height="16"><path d="M0 13 Q4 7 8 13 Q12 19 16 13" fill="none" :stroke="a.color" stroke-width="2"/></svg>
            </span>
            <span class="text-[11px] rd-muted-text truncate">{{ a.chapterLabel || "未知章节" }}</span>
            <button
              class="ml-auto rd-ib rd-ib--danger !h-7 !min-w-7"
              title="删除批注"
              @click.stop="$emit('delete', a.id)"
            >
              <UiIcon name="close" :size="13" />
            </button>
          </div>
          <div class="text-xs leading-relaxed line-clamp-2 mb-1 rd-body-text">"{{ a.textContent }}"</div>
          <div v-if="a.note" class="rd-note-box text-xs leading-relaxed p-2 rounded-lg mt-1 line-clamp-3">
            <MarkdownContent :text="a.note" />
          </div>
          <button v-if="a.note" class="text-xs underline mt-2 rd-body-text" @click.stop="$emit('view-note', a)">阅读全文</button>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import UiIcon from "../../../shared/ui/UiIcon.vue";
import MarkdownContent from "../../../shared/ui/MarkdownContent.vue";
import type {Annotation} from '../model/annotation';

defineProps<{
  visible: boolean;
  annotations: Annotation[];
}>();

defineEmits<{
  close: [];
  "jump-to": [annotation: Annotation];
  "view-note": [annotation: Annotation];
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
