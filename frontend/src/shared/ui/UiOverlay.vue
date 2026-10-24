<template>
  <Teleport to="body">
    <Transition name="ui-overlay" appear>
      <div
        v-if="open"
        class="ui-overlay ui-motion"
        :class="[`ui-overlay--${kind}`, rootClass]"
        :style="width ? { '--ui-overlay-width': width } : undefined"
        @mousedown="onScrimDown"
        @click.self="onScrimClick"
      >
        <div
          ref="panel"
          class="ui-overlay__panel"
          :class="panelClass"
          role="dialog"
          aria-modal="true"
          :aria-label="labelledby ? undefined : label"
          :aria-labelledby="labelledby"
          tabindex="-1"
          :data-testid="testId"
          @keydown.tab="trapTab"
        >
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
// 统一浮层：Teleport 到 body，层级来自 --ui-z-modal，同级按打开顺序叠放。
// 打开时背景 inert、锁定滚动；焦点移入浮层、Tab 不会跑出去；Esc 只关最上层；关闭后焦点回到触发元素。
// kind：modal 桌面居中、手机底部弹出整页；drawer 桌面右侧抽屉、手机全屏；dialog 小确认框，任何宽度都居中。
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { pushOverlay } from '../web/overlayStack';

const props = withDefaults(defineProps<{
  open: boolean;
  kind?: 'modal' | 'drawer' | 'dialog';
  /** 无可见标题时提供无障碍名称；有标题时改用 labelledby */
  label?: string;
  labelledby?: string;
  /** 面板最大宽度，例如 '920px' */
  width?: string;
  panelClass?: string | string[] | Record<string, boolean>;
  /** 加在遮罩根节点上的类名（Teleport 下 attrs 不会透传，需要显式传） */
  rootClass?: string;
  testId?: string;
  closeOnScrim?: boolean;
  closeOnEscape?: boolean;
}>(), { kind: 'modal', closeOnScrim: true, closeOnEscape: true });
const emit = defineEmits<{ close: [] }>();

const panel = ref<HTMLElement | null>(null);
let release: (() => void) | null = null;
// 只有按下和松开都在遮罩上才关闭：在面板里拖选文字、松手落到遮罩上时不能误关
let pressedOnScrim = false;
function onScrimDown(event: MouseEvent) {
  pressedOnScrim = event.target === event.currentTarget;
}
function onScrimClick() {
  if (pressedOnScrim && props.closeOnScrim) emit('close');
  pressedOnScrim = false;
}
let returnFocus: HTMLElement | null = null;

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusables(): HTMLElement[] {
  return panel.value ? [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)] : [];
}

function trapTab(event: KeyboardEvent) {
  const items = focusables();
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0], last = items[items.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function activate() {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // 按 Esc 时再读 closeOnEscape：允许打开期间切换（如批量审核“应用中”不可关闭）
  release = pushOverlay({ onEscape: () => { if (props.closeOnEscape) emit('close'); } });
  await nextTick();
  const preferred = panel.value?.querySelector<HTMLElement>('[autofocus],[data-autofocus]');
  (preferred ?? panel.value)?.focus();
}

function deactivate() {
  if (!release) return;
  release();
  release = null;
  const target = returnFocus;
  returnFocus = null;
  if (target?.isConnected) nextTick(() => target.focus());
}

watch(() => props.open, open => (open ? activate() : deactivate()), { immediate: true });
onBeforeUnmount(deactivate);
</script>

<style scoped>
.ui-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--ui-z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--ui-scrim);
  backdrop-filter: blur(4px);
  overflow-y: auto;
  font-family: var(--ui-font-sans);
}
.ui-overlay__panel {
  position: relative;
  width: 100%;
  max-width: var(--ui-overlay-width, 560px);
  max-height: calc(100dvh - 48px);
  overflow: auto;
  background: var(--ui-bg);
  color: var(--ui-fg);
  border: 1px solid var(--ui-line);
  border-radius: var(--ui-radius-overlay);
  box-shadow: 0 40px 90px -30px var(--ui-shadow);
  outline: none;
}
.ui-overlay--dialog .ui-overlay__panel { max-width: var(--ui-overlay-width, 400px); }
.ui-overlay--drawer { justify-content: flex-end; padding: 0; }
.ui-overlay--drawer .ui-overlay__panel {
  height: 100%;
  max-height: none;
  max-width: var(--ui-overlay-width, 430px);
  border-radius: 0;
  border-width: 0 0 0 1px;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
@media (max-width: 640px) {
  .ui-overlay--modal { align-items: flex-end; padding: 40px 0 0; }
  .ui-overlay--modal .ui-overlay__panel {
    max-width: none;
    max-height: calc(100dvh - 40px);
    border-radius: var(--ui-radius-overlay) var(--ui-radius-overlay) 0 0;
    border-bottom-width: 0;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .ui-overlay--drawer .ui-overlay__panel { max-width: none; border-left-width: 0; padding-top: env(safe-area-inset-top, 0px); }
  .ui-overlay--dialog { padding: 16px; }
}
.ui-overlay-enter-active, .ui-overlay-leave-active { transition: opacity 0.2s ease; }
.ui-overlay-enter-active .ui-overlay__panel, .ui-overlay-leave-active .ui-overlay__panel { transition: transform 0.25s ease; }
.ui-overlay-enter-from, .ui-overlay-leave-to { opacity: 0; }
.ui-overlay-enter-from .ui-overlay__panel, .ui-overlay-leave-to .ui-overlay__panel { transform: translateY(16px); }
.ui-overlay--drawer.ui-overlay-enter-from .ui-overlay__panel, .ui-overlay--drawer.ui-overlay-leave-to .ui-overlay__panel { transform: translateX(24px); }
</style>
