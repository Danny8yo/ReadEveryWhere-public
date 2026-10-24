<template>
  <Teleport to="body">
    <div class="ui-toasts" aria-live="polite">
      <TransitionGroup name="ui-toast">
        <div
          v-for="item in toasts.items"
          :key="item.id"
          class="ui-toast ui-motion"
          :class="`ui-toast--${item.tone}`"
          :role="item.tone === 'err' ? 'alert' : 'status'"
        >
          <UiIcon :name="item.tone === 'ok' ? 'check' : item.tone === 'err' ? 'close' : 'sparkle'" :size="14" />
          <span>{{ item.message }}</span>
          <button type="button" class="ui-toast__close" aria-label="关闭提示" @click="dismissToast(item.id)">
            <UiIcon name="close" :size="12" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// 页面内提示的渲染宿主，App.vue 挂一次。Teleport 到 body，层级在所有浮层之上。
import UiIcon from './UiIcon.vue';
import { dismissToast, toasts } from '../web/toast';
</script>

<style scoped>
.ui-toasts {
  position: fixed;
  left: 50%;
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: var(--ui-z-toast);
  display: grid;
  gap: 8px;
  width: min(420px, calc(100vw - 32px));
  pointer-events: none;
  font-family: var(--ui-font-sans);
}
@media (max-width: 640px) {
  .ui-toasts { bottom: calc(var(--app-tabbar-h) + 12px + env(safe-area-inset-bottom, 0px)); }
}
.ui-toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 10px 14px;
  border-radius: 14px;
  background: var(--ui-strong);
  color: var(--ui-on-strong);
  font-size: 13px;
  box-shadow: 0 18px 40px -14px var(--ui-shadow);
  pointer-events: auto;
}
.ui-toast span { flex: 1; min-width: 0; }
.ui-toast--ok > .ui-icon:first-child { color: var(--ui-ok); }
.ui-toast--err { background: var(--ui-surface); color: var(--ui-err); border: 1px solid color-mix(in srgb, var(--ui-err) 35%, transparent); }
.ui-toast__close {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  opacity: 0.7;
  cursor: pointer;
}
.ui-toast__close:hover { opacity: 1; }
.ui-toast-enter-active, .ui-toast-leave-active { transition: opacity 0.2s, transform 0.2s; }
.ui-toast-enter-from, .ui-toast-leave-to { opacity: 0; transform: translateY(8px); }
</style>
