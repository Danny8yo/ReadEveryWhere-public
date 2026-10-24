<template>
  <Teleport to="body">
    <div
      v-if="show"
      ref="menu"
      class="context-menu"
      role="group"
      aria-label="书籍操作"
      :style="{ top: y + 'px', left: x + 'px' }"
      @click.stop
      @contextmenu.prevent
      @keydown="onKeydown"
    >
      <!-- 保持原生 button（e2e 按 button 角色点击），不改成 menuitem -->
      <button type="button" class="context-menu__item" @click="onAction('edit')"><UiIcon name="pen" />编辑书籍信息</button>
      <button type="button" class="context-menu__item" @click="onAction('scrape')"><UiIcon name="refresh" />刮削元数据</button>
      <hr class="context-menu__sep" />
      <button type="button" class="context-menu__item context-menu__item--danger" @click="onAction('delete')"><UiIcon name="trash" />删除书籍</button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// 书籍右键菜单（手机长按同样触发）。Teleport 到 body，层级取 --ui-z-dropdown；
// 不登记浮层栈（菜单不应让背景 inert），自己处理 Esc、点外部、滚动关闭，打开时焦点进第一项。
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import UiIcon from '../../../shared/ui/UiIcon.vue';

const props = defineProps<{
  show: boolean;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  action: [type: string];
  close: [];
}>();

const menu = ref<HTMLElement | null>(null);
let returnFocus: HTMLElement | null = null;

const onAction = (type: string) => {
  emit('action', type);
  emit('close');
};

const close = () => { if (props.show) emit('close'); };

function onKeydown(event: KeyboardEvent) {
  const items = menu.value ? [...menu.value.querySelectorAll<HTMLButtonElement>('button')] : [];
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  }
}
function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    close();
    returnFocus?.focus();
  }
}

function listen(on: boolean) {
  if (on) {
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onWindowKeydown);
  } else {
    window.removeEventListener('click', close);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('keydown', onWindowKeydown);
  }
}

watch(() => props.show, async (show) => {
  listen(show);
  if (!show) return;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await nextTick();
  menu.value?.querySelector<HTMLButtonElement>('button')?.focus();
});
onBeforeUnmount(() => listen(false));
</script>

<style scoped>
.context-menu {
  position: fixed;
  z-index: var(--ui-z-dropdown);
  width: 196px;
  display: grid;
  gap: 2px;
  padding: 6px;
  border: 1px solid var(--ui-line);
  border-radius: 14px;
  background: var(--ui-surface);
  color: var(--ui-fg);
  box-shadow: 0 20px 40px -14px var(--ui-shadow);
  font-family: var(--ui-font-sans);
}
.context-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.context-menu__item:hover, .context-menu__item:focus-visible { background: var(--ui-surface2); outline: none; }
.context-menu__item--danger { color: var(--ui-err); }
.context-menu__sep { margin: 2px 4px; border: 0; border-top: 1px solid var(--ui-line); }
</style>
