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
      class="annotation-toolbar fixed z-(--ui-z-dropdown) p-1.5 flex flex-col gap-1.5 max-w-[calc(100vw-16px)]"
      :class="skinClass"
      :style="{ left: `${left}px`, top: `${top}px`, '--annotation-bottom-inset': `${bottomInset}px` }"
    >
      <label v-if="annotationOptions && annotationOptions.length > 1" class="px-2 text-xs at-muted">
        此处有 {{ annotationOptions.length }} 条批注
        <select aria-label="切换批注" class="ui-input block w-full max-w-xs !min-h-0 !py-1.5 mt-1" :value="existingAnnotation?.id" @change="$emit('select-annotation', ($event.target as HTMLSelectElement).value)">
          <option v-for="item in annotationOptions" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
      </label>
      <!-- 已有笔记：显示简短预览，点击进入完整阅读弹窗 -->
      <button
        v-if="note"
        ref="noteEl"
        type="button"
        class="at-btn flex items-start gap-1.5 text-left px-2 py-1.5 max-w-xs"
        title="阅读全文"
        @click="$emit('add-note')"
      >
        <UiIcon name="pen" :size="14" class="at-muted mt-0.5" />
        <div
          class="text-xs leading-5 at-fg2 break-words line-clamp-4"
          ><MarkdownContent :text="note" /></div
        >
      </button>

      <div class="flex flex-wrap items-center gap-1">
        <div class="flex items-center gap-0.5">
          <button
            v-for="type in availableTypes"
            :key="type"
            class="at-btn flex items-center gap-1 px-2.5 py-1.5 text-xs whitespace-nowrap"
            :class="{ 'at-btn--on': activeType === type }"
            :aria-pressed="activeType === type"
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

        <div class="at-sep" />

        <div class="flex gap-1.5 px-1">
          <button
            v-for="c in colors"
            :key="c"
            class="at-swatch"
            :class="{ 'at-swatch--on': selectedColor === c }"
            :style="{ background: c }"
            :title="c === bookColor ? '书色' : undefined"
            :aria-label="c === bookColor ? '书色' : `颜色 ${c}`"
            :aria-pressed="selectedColor === c"
            @click="selectColor(c)"
          />
        </div>

        <div class="at-sep" />

        <button v-if="existingAnnotation" class="at-btn px-2.5 py-1 text-xs" @click="$emit('new-note')">新增笔记</button>
        <!-- 批注按钮 -->
        <button
          class="at-btn flex flex-col items-center gap-0.5 px-2.5 py-1 text-xs whitespace-nowrap"
          @click="$emit('add-note')"
        >
          <UiIcon name="pen" :size="15" />
          {{ note ? "查看笔记" : "批注" }}
        </button>

        <button
          v-if="showAskAi"
          data-testid="selection-qa-ask"
          class="at-btn flex flex-col items-center gap-0.5 px-2.5 py-1 text-xs whitespace-nowrap"
          :disabled="!askAiEnabled"
          :title="askAiReason"
          @click="$emit('ask-ai')"
        >
          <UiIcon name="sparkle" :size="15" />
          询问 AI
        </button>
        <!-- 如果已有标注，显示移除 -->
        <template v-if="existingAnnotation">
          <div class="at-sep" />
          <button
            class="at-btn at-btn--danger flex flex-col items-center gap-0.5 px-2.5 py-1 text-xs"
            @click="$emit('remove', existingAnnotation.id)"
          >
            <UiIcon name="trash" :size="15" />
            移除
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import MarkdownContent from "../../../shared/ui/MarkdownContent.vue";
import UiIcon from "../../../shared/ui/UiIcon.vue";
import {
  computed,
  nextTick,
  ref,
  watch,
  onBeforeUnmount,
  onMounted,
} from "vue";
import type { AnnotationType } from "../model/annotation";

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
    /** 阅读主题对应的 .rd-skin-* 类（工具栏 Teleport 在 .book-reader 之外） */
    skinClass?: string;
    /** 书色（#rrggbb）：波浪线的默认颜色，也放在色板第一位 */
    bookColor?: string;
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

const colors = computed(() =>
  props.bookColor && !COLORS.includes(props.bookColor) ? [props.bookColor, ...COLORS] : COLORS,
);
function defaultColor(type: AnnotationType) {
  return type === "squiggly" && props.bookColor ? props.bookColor : DEFAULT_COLORS[type];
}

function selectType(type: AnnotationType) {
  activeType.value = type;
  selectedColor.value = props.existingAnnotation?.color ?? defaultColor(type);
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
.annotation-toolbar {
  background: var(--ui-surface);
  color: var(--ui-fg);
  border: 1px solid var(--ui-line);
  border-radius: 16px;
  box-shadow: 0 24px 50px -18px var(--ui-shadow);
  font-family: var(--ui-font-sans);
}
.at-muted { color: var(--ui-muted); }
.at-fg2 { color: var(--ui-fg2); }
.at-btn {
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--ui-fg2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
.at-btn:hover:not(:disabled) { background: var(--ui-surface2); color: var(--ui-fg); }
.at-btn--on { background: var(--ui-surface2); border-color: var(--ui-line); color: var(--ui-fg); font-weight: 700; }
.at-btn--danger { color: var(--ui-err); }
.at-btn--danger:hover:not(:disabled) { background: color-mix(in srgb, var(--ui-err) 12%, transparent); color: var(--ui-err); }
.at-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.at-btn:focus-visible, .at-swatch:focus-visible { outline: 2px solid var(--ui-fg); outline-offset: 1px; }
.at-sep { width: 1px; height: 28px; margin: 0 2px; background: var(--ui-line); }
.at-swatch {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--ui-fg) 15%, transparent);
  cursor: pointer;
  transition: transform 0.15s;
}
.at-swatch:hover { transform: scale(1.1); }
.at-swatch--on { box-shadow: 0 0 0 2px var(--ui-surface), 0 0 0 4px var(--ui-fg); }
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
  .annotation-toolbar .at-swatch { min-width: 36px; }
}
</style>
