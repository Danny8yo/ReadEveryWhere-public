<template>
  <aside
    ref="panel"
    data-testid="selection-qa-panel"
    class="qa-panel"
    :class="{ 'qa-dragging': panelPosition.dragging.value }"
    :style="panelPosition.style.value"
    aria-label="选区问答"
    @keydown.esc.stop="escape"
    @contextmenu.prevent="openMenu($event)"
  >
    <header class="qa-header">
      <div class="qa-drag-handle" role="button" tabindex="0" data-testid="selection-qa-drag"
        aria-label="移动问答面板，方向键移动，Home复位" title="拖动移动 · 双击复位"
        @pointerdown="panelPosition.start" @pointermove="panelPosition.pointerMove"
        @pointerup="panelPosition.stop" @pointercancel="panelPosition.stop" @lostpointercapture="panelPosition.stop"
        @dblclick="panelPosition.reset" @keydown="panelPosition.keydown">
        <h2>选区问答 <span aria-hidden="true" class="qa-grip">⠿</span></h2>
        <p>围绕原选文提问，无需预分析</p>
      </div>
      <button class="qa-more" aria-label="对话操作" @click="openMenu($event)">⋯</button>
      <button data-testid="selection-qa-minimize" aria-label="最小化选区问答" @click="emit('minimize')">最小化</button>
      <button
        data-testid="selection-qa-close"
        aria-label="关闭选区问答"
        @click="close"
      >
        关闭
      </button>
    </header>
    <div class="qa-body">
      <p v-if="qa.state.error" role="alert" class="qa-error">
        {{ qa.state.error
        }}<span v-if="/MODEL_NOT_CONFIGURED|模型.*配置/.test(qa.state.error)">
          请关闭阅读器，前往设置配置 AI 模型。</span
        >
      </p>
      <p v-if="qa.unavailableReason()" class="qa-error">
        {{ qa.unavailableReason() }}
      </p>
      <p v-if="qa.state.notice" role="status" class="qa-notice">
        {{ qa.state.notice }}
      </p>
      <div
        v-if="qa.state.pending && !qa.state.preview"
        class="qa-error"
        role="status"
      >
        <p>
          上次提交结果尚未确认。重试将复用原请求，不会重复创建或追加；请先核对，再编辑新请求。
        </p>
        <button :disabled="qa.state.busy" @click="qa.retryPending()">
          核对并重试上次提交
        </button>
      </div>
      <details
        data-testid="selection-qa-history"
        :open="!qa.state.selection && !qa.state.conversation"
      >
        <summary>本书问答记录</summary>
        <p v-if="!qa.state.conversations.length">
          暂无记录。请在 EPUB 正文选择文字后点击“询问 AI”。
        </p>
        <button
          v-for="item in qa.state.conversations"
          :key="item.id"
          class="qa-history-item"
          :data-testid="`selection-qa-conversation-${item.id}`"
          :disabled="qa.state.busy"
          @click="qa.select(item.id)"
        >
          {{ item.firstQuestion }}
          <span v-if="item.status === 'frozen'">（旧版本）</span>
        </button>
        <button
          data-testid="selection-qa-history-more"
          v-if="qa.state.conversationCursor"
          :disabled="qa.state.busy"
          @click="qa.listMore()"
        >
          更多记录
        </button>
      </details>
      <section v-if="original" class="qa-original">
        <h3>原选文</h3>
        <p>{{ original }}</p>
        <button
          v-if="qa.state.conversation"
          :disabled="qa.state.busy || frozen"
          @click="qa.jump()"
        >
          返回原选文
        </button>
      </section>
      <p v-if="frozen" class="qa-error">
        此会话对应旧版本，仅供查看。请重新打开书籍并选择文字，创建新对话。
      </p>
      <p v-if="qa.state.selection && !qa.state.conversation" class="qa-notice">
        新的选区将创建独立对话；其他问答保留在本书记录中。
      </p>
      <button
        v-if="qa.state.turns.length > shownCount"
        @click="shownCount += 20"
      >
        显示更早的问答
      </button>
      <article
        v-for="turn in shownTurns"
        :key="turn.id"
        :data-testid="`selection-qa-turn-${turn.id}`"
        class="qa-turn"
      >
        <section class="qa-user-message"><span class="qa-speaker">你</span><p class="qa-user-bubble qa-text">{{ turn.question }}</p></section>
        <section class="qa-assistant-message" tabindex="0" :data-qa-turn="turn.id"
          @contextmenu.stop.prevent="openMenu($event, turn)" @keydown.shift.f10.prevent="openMenu($event, turn)">
          <div class="qa-turn-heading"><h3>阅读助手</h3><span role="status">{{ statusLabel(turn) }}</span>
            <button class="qa-more" :data-testid="`selection-qa-menu-${turn.id}`" aria-label="回答操作" @pointerdown.prevent @click="openMenu($event, turn)">⋯</button>
          </div>
          <QaProcessDisclosure :steps="turn.process ?? []" :active="isActive(turn)" />
          <p v-if="turn.citations.length" class="qa-citation-source">书内引用来源：《{{ sourceTitleFor(turn) }}》</p>
          <div class="qa-assistant-bubble">
            <div class="qa-answer" :data-testid="`selection-qa-answer-${turn.id}`" :data-qa-answer="turn.id"
              @mouseup="captureSelection($event, turn)" @touchend="captureSelection($event, turn)">
              <MarkdownContent :text="turn.answer" :citation-ids="turn.citations.map(e => e.evidenceId)" :citation-source-title="sourceTitleFor(turn)" :disabled="frozen || qa.state.busy" @citation="qa.jump(turn.id, $event)" />
            </div>
            <p v-if="!isActive(turn) && turn.status !== 'completed'" class="qa-incomplete">
              {{ turn.status === 'cancelled' ? '已停止' : '未完成' }}{{ turn.errorCode ? ` · ${reasonLabel(turn.errorCode)}` : '' }}。
              <template v-if="turn.answer.trim()">已生成内容仍可复制或编辑应用。</template>
            </p>
          </div>
        </section>
      </article>
      <button
        v-if="qa.state.turnCursor !== null"
        :disabled="qa.state.busy"
        @click="qa.moreTurns()"
      >
        加载后续问答
      </button>
      <p v-if="qa.state.streamStatus === 'reconnecting'" role="status">
        问答连接正在恢复，后台任务继续运行。<button @click="qa.refresh()">
          刷新快照
        </button>
      </p>

    </div>
    <div v-if="menu" ref="menuElement" class="qa-context-menu" role="menu" aria-label="问答操作"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @keydown="menuKeys">
      <template v-if="menu.turn">
        <button role="menuitem" :disabled="!menu.turn.answer" @click="copy(menu.turn); closeMenu()">复制回答</button>
        <button role="menuitem" :data-testid="`selection-qa-preview-${menu.turn.id}`" :disabled="!canApply(menu.turn)" @click="menuPreview()">整条回答存为批注</button>
        <button role="menuitem" data-testid="selection-qa-preview-selection" :disabled="!canApply(menu.turn) || selectedAnswer?.turnId !== menu.turn.id" @click="menuPreview(true)">选中部分存为批注</button>
        <button v-if="!isActive(menu.turn) && menu.turn.status !== 'completed'" role="menuitem" :disabled="active || frozen || qa.state.busy || !!qa.state.pending" @click="qa.send(menu.turn.id); closeMenu()">重新提问（创建新轮次）</button>
        <hr />
      </template>
      <button role="menuitem" @click="panelPosition.reset(); closeMenu()">复位面板位置</button>
      <button role="menuitem" :disabled="qa.state.busy || !qa.state.conversation" @click="qa.refresh(); closeMenu()">刷新问答</button>
      <button role="menuitem" :disabled="active || qa.state.busy || !qa.state.conversation" @click="remove(); closeMenu()">删除对话</button>
    </div>
    <form class="qa-composer" @submit.prevent="qa.send()">
      <label for="selection-qa-question">{{
        qa.state.conversation ? "继续追问" : "你的问题"
      }}</label>
      <textarea
        id="selection-qa-question"
        ref="question"
        v-model="qa.state.question"
        data-testid="selection-qa-question"
        maxlength="4000"
        rows="3"
        placeholder="解释这段话，或询问它与书中其他内容的关系"
        :disabled="
          active || frozen || !!qa.state.pending || !!qa.unavailableReason()
        "
      />
      <button
        v-if="active"
        type="button"
        data-testid="selection-qa-stop"
        :disabled="qa.state.busy"
        @click="qa.stop()"
      >
        停止回答
      </button>
      <button
        v-else
        data-testid="selection-qa-send"
        type="submit"
        :disabled="
          qa.state.busy ||
          !!qa.unavailableReason() ||
          frozen ||
          !!qa.state.pending ||
          !qa.state.question.trim() ||
          (!qa.state.selection && !qa.state.conversation)
        "
      >
        发送
      </button>
    </form>
    <div
      v-if="qa.state.preview"
      class="qa-modal-backdrop"
      @keydown.esc.stop="qa.state.preview = null"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="qa-apply-title"
        ref="applyDialog"
        @keydown.tab="trapDialog"
        data-testid="selection-qa-apply-dialog"
        class="qa-apply"
      >
        <h2 id="qa-apply-title">预览并确认批注</h2>
        <p v-if="qa.state.error" role="alert" class="qa-error">
          {{ qa.state.error }}
        </p>
        <div v-if="qa.state.pending" role="status" class="qa-error">
          <p>保存结果尚未确认。请核对上次提交，草稿暂时锁定。</p>
          <button
            data-testid="selection-qa-apply-retry"
            :disabled="qa.state.busy"
            @click="qa.retryPending()"
          >
            核对并重试上次提交
          </button>
        </div>
        <label
          >保存目标<select
            v-model="qa.state.preview.targetId"
            data-testid="selection-qa-target"
            :disabled="!!qa.state.pending"
          >
            <option value="new">在原选文处新建批注</option>
            <option
              v-for="item in qa.state.preview.annotations"
              :key="item.id"
              :value="item.id"
            >
              追加到：{{ item.textContent.slice(0, 60) }} ·
              {{ (item.note || "无笔记").slice(0, 40) }}
            </option>
          </select></label
        >
        <p>追加只允许原选区对应的批注，服务器会精确核对位置。</p>
        <div v-if="qa.state.preview.targetId !== 'new'">
          <h3>最新原批注（保留）</h3>
          <MarkdownContent class="qa-original-note" :text="targetNote" />
        </div>
        <label
          >本次追加文字<textarea
            v-model="qa.state.preview.text"
            ref="appendInput"
            data-testid="selection-qa-append-text"
            rows="9"
            maxlength="50000"
            :disabled="!!qa.state.pending"
          />
        </label>
        <p v-if="qa.state.preview.conflict" class="qa-error">
          目标已修改或删除。草稿已保留，请核对最新原批注与保存目标，再重新确认。<button
            @click="qa.reconfirm()"
          >
            已核对，重新确认
          </button>
        </p>
        <div class="qa-actions">
          <button :disabled="qa.state.busy" @click="qa.state.preview = null">
            取消预览</button
          ><button
            data-testid="selection-qa-apply-confirm"
            :disabled="
              qa.state.busy || qa.state.preview.conflict || !!qa.state.pending
            "
            @click="qa.apply()"
          >
            {{ qa.state.preview.targetId === "new" ? "确认新建" : "确认追加" }}
          </button>
        </div>
      </section>
    </div>
  </aside>
</template>
<script setup lang="ts">
import {
  computed,
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from "vue";
import { useQaPanelPosition } from "./useQaPanelPosition";
import QaProcessDisclosure from "./QaProcessDisclosure.vue";
import MarkdownContent from "../MarkdownContent.vue";
import type { useSelectionQa } from "../../features/selection-qa/web/useSelectionQa";
import {
  isActive,
  type Turn,
} from "../../features/selection-qa/model/selectionQa";
import { qaReason } from "../../features/selection-qa/domain/messages";
import {
  plainAnswer,
} from "../../features/selection-qa/domain/protocol";
const emit = defineEmits<{ minimize: [] }>();
const props = defineProps<{ qa: ReturnType<typeof useSelectionQa>; bookTitle: string }>();
const panel = ref<HTMLElement | null>(null),
  question = ref<HTMLTextAreaElement | null>(null),
  selectedAnswer = ref<{ turnId: string; text: string } | null>(null);
const panelPosition = useQaPanelPosition(panel);
const shownCount = ref(20);
const shownTurns = computed(() =>
  props.qa.state.turns.slice(-shownCount.value),
);
watch(
  () => props.qa.state.conversation?.id,
  () => {
    shownCount.value = 20;
    selectedAnswer.value = null;
    closeMenu();
  },
);
const original = computed(
  () =>
    props.qa.state.conversation?.selection.displayedQuote ||
    props.qa.state.selection?.displayedQuote,
);
const frozen = computed(() => props.qa.state.conversation?.status === "frozen");
const active = computed(() => props.qa.state.turns.some(isActive));
function sourceTitleFor(turn: Turn): string {
  const source = turn.process?.find(step => step.detail.operation === 'source_context')?.detail.sourceBook;
  if (source === undefined) return props.bookTitle;
  if (!source || typeof source !== 'object' || !('title' in source) || typeof source.title !== 'string' || !source.title.trim()) throw new Error('非法书籍来源');
  return source.title;
}
const targetNote = computed(() => {
  const draft = props.qa.state.preview;
  return (
    draft?.annotations.find((a) => a.id === draft.targetId)?.note ??
    "（目标已删除或无原笔记）"
  );
});
const applyDialog = ref<HTMLElement | null>(null),
  appendInput = ref<HTMLTextAreaElement | null>(null);
let applyOpener: HTMLElement | null = null;
let opener: HTMLElement | null = null;
watch(
  () => props.qa.state.preview,
  async (value, previous) => {
    await nextTick();
    if (value) appendInput.value?.focus();
    else if (previous && applyOpener?.isConnected) applyOpener.focus();
  },
);
const menu = ref<{ x: number; y: number; turn?: Turn } | null>(null);
const menuElement = ref<HTMLElement | null>(null);
let menuOpener: HTMLElement | null = null;
function canApply(turn: Turn) { return !!turn.answer.trim() && !isActive(turn) && !frozen.value && !props.qa.state.busy && !props.qa.state.pending; }
async function openMenu(event: MouseEvent | KeyboardEvent, turn?: Turn) {
  selectionChanged();
  menuOpener = event.currentTarget as HTMLElement;
  const box = menuOpener.getBoundingClientRect();
  const x = event instanceof MouseEvent && event.button === 2 ? event.clientX : box.right;
  const y = event instanceof MouseEvent && event.button === 2 ? event.clientY : box.bottom;
  menu.value = { x: Math.min(x, window.innerWidth - 248), y, turn };
  await nextTick();
  if (!menu.value || !menuElement.value) return;
  menu.value.x = Math.max(8, menu.value.x);
  menu.value.y = Math.max(8, Math.min(y, window.innerHeight - menuElement.value.offsetHeight - 8));
  menuElement.value.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
}
function closeMenu() { menu.value = null; if (menuOpener?.isConnected) menuOpener.focus(); }
function menuPreview(partial = false) {
  if (!menu.value?.turn) return;
  const turn = menu.value.turn;
  applyOpener = menuOpener;
  const text = partial ? selectedAnswer.value?.text : undefined;
  closeMenu();
  void props.qa.preview(turn.id, text);
}
function escape() { if (menu.value) closeMenu(); else close(); }
function menuKeys(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Tab') { event.stopPropagation(); closeMenu(); return; }
  if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...menuElement.value!.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}
function outsideMenu(event: PointerEvent) { if (menu.value && !menuElement.value?.contains(event.target as Node) && !menuOpener?.contains(event.target as Node)) closeMenu(); }
function trapDialog(event: KeyboardEvent) {
  const controls = Array.from(
    applyDialog.value?.querySelectorAll<HTMLElement>(
      "button:not([disabled]),textarea:not([disabled]),select:not([disabled])",
    ) ?? [],
  );
  const first = controls[0],
    last = controls[controls.length - 1];
  if (!first) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
function selectionChanged() {
  const selection = window.getSelection();
  if (!selection?.anchorNode || !selection.focusNode || selection.isCollapsed) {
    if (!menu.value) selectedAnswer.value = null;
    return;
  }
  const element =
    selection.anchorNode instanceof Element
      ? selection.anchorNode
      : selection.anchorNode.parentElement;
  const root = element?.closest<HTMLElement>("[data-qa-answer]");
  if (
    !root ||
    !panel.value?.contains(root) ||
    !root.contains(selection.focusNode)
  )
    return;
  const turn = props.qa.state.turns.find((t) => t.id === root.dataset.qaAnswer);
  if (turn && selection.toString().trim())
    selectedAnswer.value = { turnId: turn.id, text: selection.toString() };
}
onMounted(() => {
  document.addEventListener("selectionchange", selectionChanged);
  document.addEventListener("pointerdown", outsideMenu);
  opener =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  void nextTick(() => question.value?.focus());
});
onBeforeUnmount(() => {
  document.removeEventListener("selectionchange", selectionChanged);
  document.removeEventListener("pointerdown", outsideMenu);
  if (opener?.isConnected) opener.focus();
  else
    document
      .querySelector<HTMLElement>("[data-testid=selection-qa-open]")
      ?.focus();
});
function close() {
  props.qa.close();
}
function captureSelection(event: Event, turn: Turn) {
  const root = event.currentTarget as HTMLElement;
  const selection = window.getSelection();
  if (
    selection &&
    selection.anchorNode &&
    selection.focusNode &&
    root.contains(selection.anchorNode) &&
    root.contains(selection.focusNode) &&
    selection.toString().trim()
  )
    selectedAnswer.value = { turnId: turn.id, text: selection.toString() };
}
async function copy(turn: Turn) {
  try {
    await navigator.clipboard.writeText(plainAnswer(turn));
    props.qa.state.notice = "已复制回答。";
  } catch {
    props.qa.state.error = "无法访问剪贴板，请直接选择并复制回答。";
  }
}
function remove() {
  if (window.confirm("删除整段对话？已保存的批注会保留。"))
    void props.qa.delete();
}
function reasonLabel(code: string) {
  return qaReason(code).replace(/[。.]$/, "");
}
function statusLabel(turn: Turn) {
  if (!isActive(turn)) return turn.status === "completed" ? "已完成" : turn.status === "cancelled" ? "已停止" : "未完成";
  return (
    (
      {
        queued: "排队中",
        context: "读取附近正文",
        planning: "模型正在决定查阅内容",
        retrieving: "检索书内内容",
        reading: "读取正文",
        index_wait: "正在准备本书索引",
        answer: turn.answer ? "正在回答" : "等待模型输出",
      } as Record<string, string>
    )[turn.phase] ?? "处理中"
  );
}
</script>
<style scoped>
.qa-panel {
  position: absolute;
  right: 8px;
  top: calc(var(--rd-bar-top, 0px) + 8px);
  height: min(760px, calc(100% - var(--rd-bar-top, 0px) - var(--rd-bar-bottom, 0px) - 16px));
  width: min(540px, calc(100% - 16px));
  z-index: 55;
  background: transparent;
  isolation: isolate;
  color: var(--rd-fg, #222);
  border: 1px solid var(--rd-border);
  border-radius: 16px;
  box-shadow: 0 12px 40px #0002;
  display: flex;
  flex-direction: column;
  font-size: 14px;
}
.qa-panel::before {
  content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit;
  background: color-mix(in srgb, var(--rd-surface-solid, #fff) 78%, transparent);
  -webkit-backdrop-filter: blur(20px) saturate(135%);
  backdrop-filter: blur(20px) saturate(135%);
  pointer-events: none;
}
.qa-drag-handle { cursor: grab; touch-action: none; user-select: none; border-radius: 6px; }
.qa-drag-handle:focus-visible { outline: 2px solid var(--rd-accent); outline-offset: 3px; }
.qa-dragging .qa-drag-handle { cursor: grabbing; }
.qa-grip { font-size: 16px; opacity: .45; margin-left: 6px; }
@supports not (backdrop-filter: blur(1px)) {
  .qa-panel::before { background: var(--rd-surface-solid, #fff); }
}
.qa-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--rd-border);
}
.qa-header h2,
.qa-apply h2 {
  font-weight: 700;
  font-size: 18px;
}
.qa-header p {
  font-size: 12px;
  opacity: 0.7;
}
.qa-body {
  overflow: auto;
  overscroll-behavior: contain;
  padding: 16px;
  flex: 1;
  min-height: 0;
}
.qa-panel button {
  padding: 6px 9px;
  border: 1px solid var(--rd-border);
  border-radius: 6px;
  cursor: pointer;
}
.qa-panel button:disabled {
  opacity: 0.45;
  cursor: default;
}
.qa-panel button:focus-visible,
.qa-panel textarea:focus-visible,
.qa-panel select:focus-visible {
  outline: 2px solid var(--rd-accent);
  outline-offset: 2px;
}
.qa-history-item {
  display: block;
  width: 100%;
  text-align: left;
  margin-top: 6px;
}
.qa-original {
  margin: 16px 0;
  padding: 12px;
  background: var(--rd-chip-bg);
  border-left: 3px solid var(--rd-border);
}
.qa-original p {
  max-height: 180px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.qa-turn {
  margin: 20px 0;
  border-top: 1px solid var(--rd-border);
  padding-top: 12px;
}
.qa-turn h3,
.qa-original h3 {
  font-weight: 600;
  margin-bottom: 7px;
}
.qa-text,
.qa-answer,
.qa-original-note {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
  line-height: 1.7;
}
.qa-answer {
  margin: 10px 0;
}
.qa-answer button {
  display: inline;
  color: var(--rd-accent);
  border: 0;
  padding: 0 3px;
}
.qa-turn-heading {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 14px;
}
.qa-turn-heading span,
.qa-incomplete {
  font-size: 12px;
  opacity: 0.75;
}
.qa-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.qa-error {
  padding: 10px;
  background: var(--rd-chip-bg);
  color: var(--rd-fg);
  border-left: 3px solid var(--rd-accent);
  overflow-wrap: anywhere;
}
.qa-notice {
  padding: 8px;
  background: var(--rd-chip-bg);
}
.qa-composer {
  border-top: 1px solid var(--rd-border);
  padding: 12px;
  flex-shrink: 0;
}
.qa-composer label,
.qa-apply label {
  display: block;
  font-size: 13px;
}
.qa-panel textarea,
.qa-panel select {
  display: block;
  width: 100%;
  padding: 8px;
  margin: 6px 0;
  border: 1px solid var(--rd-border);
  border-radius: 6px;
  background: inherit;
  color: inherit;
}
.qa-composer button {
  float: right;
}
.qa-modal-backdrop {
  position: fixed;
  inset: 0;
  background: #0005;
  z-index: 150;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.qa-apply {
  background: var(--rd-surface-solid, #fff);
  color: var(--rd-fg, #222);
  padding: 20px;
  border-radius: 12px;
  max-width: 600px;
  width: 100%;
  max-height: 90dvh;
  overflow: auto;
}
.qa-original-note {
  max-height: 150px;
  overflow: auto;
  background: var(--rd-chip-bg);
  padding: 10px;
}
@media (max-width: 600px) {
  .qa-panel {
    width: calc(100% - 16px);
    height: min(680px, calc(85% - var(--rd-bar-top, 0px) - var(--rd-bar-bottom, 0px) - 16px));
    z-index: 80;
  }
  .qa-body {
    padding: 12px;
  }
  .qa-apply {
    max-height: 95dvh;
    padding: 14px;
  }
  .qa-modal-backdrop {
    padding: 8px;
  }
}
</style>

<style scoped>

.qa-header > div { flex: 1; }
.qa-turn { border: 0; padding: 0; display: flex; flex-direction: column; gap: 16px; margin: 24px 0; }
.qa-user-message { align-self: flex-end; max-width: 86%; }
.qa-speaker { font-size: 12px; opacity: .6; }
.qa-user-bubble { margin-top: 5px; padding: 10px 14px; border-radius: 16px 4px 16px 16px; background: var(--rd-chip-bg); border: 1px solid var(--rd-border); }
.qa-assistant-message { align-self: flex-start; width: 94%; min-width: 0; }
.qa-turn-heading { align-items: center; margin-top: 0; gap: 8px; }
.qa-turn-heading h3 { margin: 0; flex: 1; font-size: 12px; opacity: .7; }
.qa-assistant-bubble { margin-top: 6px; padding: 14px; border: 1px solid var(--rd-border); border-radius: 4px 16px 16px 16px; background: color-mix(in srgb, var(--rd-surface-solid, #fff) 68%, transparent); }
.qa-answer { margin: 0; white-space: normal; }
.qa-panel .qa-more { border: 0; min-width: 32px; min-height: 32px; font-size: 20px; padding: 0 6px; }
.qa-context-menu { position: fixed; z-index: 180; width: 240px; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); overflow: auto; padding: 6px; border: 1px solid var(--rd-border); border-radius: 10px; background: var(--rd-surface-solid, #fff); box-shadow: 0 8px 30px #0003; }
.qa-context-menu button { display: block; width: 100%; text-align: left; border: 0; padding: 10px; }
.qa-context-menu button:hover, .qa-context-menu button:focus-visible { background: var(--rd-chip-bg); }
.qa-context-menu hr { margin: 4px 0; border-color: var(--rd-border); }
</style>
