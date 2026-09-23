<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="toolbarEl"
      data-reader-selection-actions
      role="group"
      aria-label="选文笔记工具栏"
      tabindex="-1"
      @pointerdown="captureActionFocus"
      class="annotation-toolbar fixed z-[100] bg-white rounded-xl shadow-2xl border border-gray-200 p-1.5 flex flex-col gap-1.5 max-w-[calc(100vw-16px)]"
      :style="{ left: `${left}px`, top: `${top}px`, '--annotation-bottom-inset': `${bottomInset}px` }"
    >
      <label v-if="annotationOptions && annotationOptions.length > 1" class="px-2 text-xs text-gray-600">
        此处有 {{ annotationOptions.length }} 条批注
        <select aria-label="切换批注" class="block w-full max-w-xs border rounded p-1.5 mt-1" :value="existingAnnotation?.id" @change="$emit('select-annotation', ($event.target as HTMLSelectElement).value)">
          <option v-for="item in annotationOptions" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
      </label>
      <!-- 已有笔记：显示简短预览，点击进入完整阅读弹窗 -->
      <button
        v-if="note"
        ref="noteEl"
        type="button"
        class="flex items-start gap-1.5 text-left px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors max-w-xs group"
        title="阅读全文"
        @click="$emit('add-note')"
      >
        <span
          class="text-sm leading-5 text-gray-400 group-hover:text-gray-600 shrink-0"
          >&#9998;</span
        >
        <div
          class="text-xs leading-5 text-gray-700 break-words line-clamp-4"
          ><MarkdownContent :text="note" /></div
        >
      </button>

      <div class="flex flex-wrap items-center gap-1">
        <div class="flex items-center gap-0.5">
          <button
            v-for="type in availableTypes"
            :key="type"
            class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap border transition-colors"
            :class="
              activeType === type
                ? 'border-gray-200 bg-gray-100 text-gray-900'
                : 'border-transparent hover:bg-gray-100 text-gray-600'
            "
            @click="selectType(type)"
          >
            <span
              v-if="type === 'highlight'"
              class="w-3.5 h-3.5 rounded-sm inline-block"
              :style="{ background: selectedColor }"
            />
            <span
              v-else-if="type === 'underline'"
              class="font-bold text-sm"
              :style="{
                textDecoration: 'underline',
                textDecorationColor: selectedColor,
                textUnderlineOffset: '2px',
              }"
              >U</span
            >
            <span
              v-else
              class="w-3.5 h-3.5 inline-flex items-center justify-center"
            >
              <svg width="14" height="14">
                <path
                  d="M0 11 Q3.5 5 7 11 Q10.5 17 14 11"
                  fill="none"
                  :stroke="selectedColor"
                  stroke-width="2"
                />
              </svg>
            </span>
            {{ TYPE_LABELS[type] }}
          </button>
        </div>

        <div class="w-px h-7 bg-gray-200 mx-0.5" />

        <div class="flex gap-1.5 px-1">
          <button
            v-for="c in COLORS"
            :key="c"
            class="w-5 h-5 rounded-full border transition-transform hover:scale-110"
            :class="
              selectedColor === c
                ? 'border-white ring-2 ring-gray-900 ring-offset-1'
                : 'border-black/10'
            "
            :style="{ background: c }"
            @click="selectColor(c)"
          />
        </div>

        <div class="w-px h-7 bg-gray-200 mx-0.5" />

        <button v-if="existingAnnotation" class="px-2.5 py-1 rounded-lg text-xs hover:bg-gray-100" @click="$emit('new-note')">新增笔记</button>
        <!-- 批注按钮 -->
        <button
          class="flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap border border-transparent hover:bg-gray-100 text-gray-600 transition-colors"
          @click="$emit('add-note')"
        >
          <span class="text-base leading-none">&#9998;</span>
          {{ note ? "查看笔记" : "批注" }}
        </button>

        <button
          v-if="showAskAi"
          data-testid="selection-qa-ask"
          class="px-2 py-1 text-xs rounded-lg hover:bg-gray-100"
          :disabled="!askAiEnabled"
          :title="askAiReason"
          @click="$emit('ask-ai')"
        >
          询问 AI
        </button>
        <!-- 如果已有标注，显示移除 -->
        <template v-if="existingAnnotation">
          <div class="w-px h-7 bg-gray-200 mx-0.5" />
          <button
            class="flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 border border-transparent transition-colors"
            @click="$emit('remove', existingAnnotation.id)"
          >
            <span class="text-base leading-none">&times;</span>
            移除
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import MarkdownContent from "./MarkdownContent.vue";
import {
  computed,
  nextTick,
  ref,
  watch,
  onBeforeUnmount,
  onMounted,
} from "vue";
import type { AnnotationType } from "../features/reader/model/annotation";

const COLORS = [
  "#ffeb3b",
  "#a5d6a7",
  "#90caf9",
  "#f48fb1",
  "#ffcc80",
  "#e53935",
  "#8e24aa",
];

const DEFAULT_COLORS: Record<AnnotationType, string> = {
  highlight: "#ffeb3b",
  underline: "#2196f3",
  squiggly: "#ff9800",
};

const TYPE_LABELS: Record<AnnotationType, string> = {
  highlight: "高亮",
  underline: "下划线",
  squiggly: "波浪线",
};

const props = withDefaults(
  defineProps<{
    visible: boolean;
    bottomInset?: number;
    position: { x: number; y: number };
    existingAnnotation?: {
      id: string;
      annotationType: AnnotationType;
      color: string;
      location: string;
    } | null;
    /** 该标注已有的笔记；有则在工具栏顶部就地展示，点击进编辑。 */
    note?: string | null;
    annotationOptions?: Array<{ id: string; label: string }>;
    mode?: "epub" | "pdf";
    showAskAi?: boolean;
    askAiEnabled?: boolean;
    askAiReason?: string;
  }>(),
  {
    mode: "epub",
    bottomInset: 0,
  },
);

const toolbarEl = ref<HTMLElement | null>(null);
function captureActionFocus(event: PointerEvent) {
  // 在浏览器清除 iframe 选区之前标记焦点归属；不阻止系统选字或原生 select。
  if ((event.target as Element).closest("button")) {
    toolbarEl.value!.focus({ preventScroll: true });
  }
}
const toolbarHeight = ref(0), viewportHeight = ref(window.innerHeight);
const toolbarWidth = ref(0),
  viewportWidth = ref(window.innerWidth);
let observer: ResizeObserver | null = null;
const left = computed(() =>
  Math.max(
    8,
    Math.min(props.position.x, viewportWidth.value - toolbarWidth.value - 8),
  ),
);
function resized() {
  viewportWidth.value = window.innerWidth;
  viewportHeight.value = window.innerHeight;
}
onMounted(() => window.addEventListener("resize", resized));
watch(toolbarEl, (element) => {
  observer?.disconnect();
  if (element) {
    toolbarWidth.value = element.getBoundingClientRect().width;
    toolbarHeight.value = element.getBoundingClientRect().height;
    observer = new ResizeObserver(() => {
      toolbarWidth.value = element.getBoundingClientRect().width;
    toolbarHeight.value = element.getBoundingClientRect().height;
    });
    observer.observe(element);
  }
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener("resize", resized);
});
const noteEl = ref<HTMLElement | null>(null);
const noteOffset = ref(0);

// position.y 是按“按钮横条的顶边”算的（调用方减了 70px 让浮层落在选区上方）。
// 笔记块加在横条之上会把浮层撑高，所以整体上移它的高度，横条仍停在原处，
// 不会反过来盖住刚点的那条批注。
const top = computed(() => Math.max(8, Math.min(props.position.y - noteOffset.value, viewportHeight.value - toolbarHeight.value - 8)));

watch(
  () => [props.visible, props.note, props.position] as const,
  async () => {
    if (!props.visible || !props.note) {
      noteOffset.value = 0;
      return;
    }
    await nextTick();
    const h = noteEl.value?.offsetHeight ?? 0;
    noteOffset.value = h > 0 ? h + 6 : 0; // 6px = flex gap-1.5
  },
  { immediate: true, deep: true },
);

const emit = defineEmits<{
  "select-annotation": [id: string];
  "ask-ai": [];
  apply: [type: AnnotationType, color: string];
  "add-note": [];
  "new-note": [];
  remove: [id: string];
}>();

const activeType = ref<AnnotationType>("highlight");
const selectedColor = ref("#ffeb3b");
const availableTypes = computed<AnnotationType[]>(() =>
  props.mode === "pdf" ? ["highlight"] : ["highlight", "underline", "squiggly"],
);

function selectType(type: AnnotationType) {
  activeType.value = type;
  selectedColor.value = props.existingAnnotation?.color ?? DEFAULT_COLORS[type];
  emit("apply", type, selectedColor.value);
}

function selectColor(color: string) {
  selectedColor.value = color;
  emit("apply", activeType.value, color);
}

watch(
  () => props.existingAnnotation,
  (existing) => {
    if (existing) {
      activeType.value = existing.annotationType;
      selectedColor.value = existing.color;
    }
  },
  { immediate: true },
);
</script>

<style scoped>
@media (max-width: 767px) {
  .annotation-toolbar {
    left: 8px !important;
    right: 8px;
    top: auto !important;
    bottom: calc(var(--annotation-bottom-inset, 0px) + env(safe-area-inset-bottom, 0px) + 8px);
    max-height: calc(100dvh - var(--annotation-bottom-inset, 0px) - env(safe-area-inset-bottom, 0px) - 24px);
    overflow-y: auto;
  }
  .annotation-toolbar button { min-height: 36px; }
  .annotation-toolbar button.rounded-full { min-width: 36px; }
}
</style>
