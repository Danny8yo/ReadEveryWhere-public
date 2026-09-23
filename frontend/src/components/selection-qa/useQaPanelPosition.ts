import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

/** Screen-local layout only; never resizes the EPUB renderer or persists reading data. */
export function useQaPanelPosition(panel: Ref<HTMLElement | null>) {
  const position = ref<{ x: number; y: number } | null>(null);
  const dragging = ref(false);
  let drag: { id: number; x: number; y: number; left: number; top: number; handle: HTMLElement } | null = null;
  let observer: ResizeObserver | undefined;
  let resizeFrame = 0;
  const style = computed(() => position.value ? { left: `${position.value.x}px`, top: `${position.value.y}px`, right: 'auto' } : {});
  function bounds() {
    const el = panel.value;
    if (!el || !el.parentElement || !el.offsetWidth || !el.offsetHeight) return null;
    const parent = el.parentElement;
    const css = getComputedStyle(parent);
    const top = (parseFloat(css.getPropertyValue('--rd-bar-top')) || 0) + 8;
    const bottom = (parseFloat(css.getPropertyValue('--rd-bar-bottom')) || 0) + 8;
    return { minX: 8, maxX: Math.max(8, parent.clientWidth - el.offsetWidth - 8), minY: top, maxY: Math.max(top, parent.clientHeight - bottom - el.offsetHeight) };
  }
  function move(x: number, y: number) {
    const b = bounds();
    if (b) {
      const next = { x: Math.max(b.minX, Math.min(b.maxX, x)), y: Math.max(b.minY, Math.min(b.maxY, y)) };
      if (position.value?.x !== next.x || position.value?.y !== next.y) position.value = next;
    }
  }
  function constrain() { if (position.value) move(position.value.x, position.value.y); }
  function stop() {
    if (drag?.handle.hasPointerCapture(drag.id)) drag.handle.releasePointerCapture(drag.id);
    drag = null; dragging.value = false;
  }
  function start(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || !panel.value) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: panel.value.offsetLeft, top: panel.value.offsetTop, handle };
    handle.setPointerCapture(event.pointerId);
    dragging.value = true;
  }
  function pointerMove(event: PointerEvent) {
    if (drag && event.pointerId === drag.id) move(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
  }
  function reset() { stop(); position.value = null; }
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Home') { event.preventDefault(); event.stopPropagation(); reset(); return; }
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction || !panel.value) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 40 : 16;
    move(panel.value.offsetLeft + direction[0]! * step, panel.value.offsetTop + direction[1]! * step);
  }
  onMounted(() => {
    observer = new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(constrain); });
    if (panel.value) { observer.observe(panel.value); if (panel.value.parentElement) observer.observe(panel.value.parentElement); }
    window.addEventListener('resize', constrain);
  });
  onBeforeUnmount(() => { stop(); cancelAnimationFrame(resizeFrame); observer?.disconnect(); window.removeEventListener('resize', constrain); });
  return { style, dragging, start, pointerMove, stop, reset, keydown };
}
