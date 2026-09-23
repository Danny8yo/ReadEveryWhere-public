<template>
  <aside
    class="ai-reading-panel rd-panel rd-inset-panel absolute right-0 z-40 border-l"
  >
    <header class="ai-panel-header">
      <div class="min-w-0">
        <div class="ai-eyebrow">{{ bookTitle }}</div>
        <h2 class="truncate">AI 阅读（开发中）</h2>
      </div>
      <div class="flex items-center gap-1">
        <button
          class="ai-icon-button"
          type="button"
          title="会话历史"
          @click="showHistory = !showHistory"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l3 2" />
          </svg>
        </button>
        <button
          class="ai-icon-button"
          type="button"
          title="刷新"
          :disabled="loading"
          @click="refresh"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
            <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
          </svg>
        </button>
        <button
          class="ai-icon-button"
          type="button"
          title="关闭"
          @click="emit('close')"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="m18 6-12 12M6 6l12 12" />
          </svg>
        </button>
      </div>
    </header>

    <template v-if="analysisLoading && !bookAnalysis">
      <div class="ai-panel-scroll">
        <section class="ai-section">
          <div class="ai-empty">正在读取 AI 预分析状态...</div>
        </section>
      </div>
    </template>
    <template v-else-if="!analysisReady">
      <div class="ai-panel-scroll">
        <section class="ai-section ai-analysis-gate">
          <div class="ai-section-heading"><h3>AI 预分析</h3></div>
          <p>{{ analysisGateMessage }}</p>
          <button
            v-if="analysisActionLabel"
            class="ai-command primary w-full mt-5"
            type="button"
            :disabled="analysisAnalyzing || analysisLoading"
            @click="handleAnalysisAction"
          >
            {{ analysisAnalyzing ? "正在提交..." : analysisActionLabel }}
          </button>
          <div v-if="analysisError" class="ai-error" role="alert">
            {{ analysisError }}
          </div>
        </section>
      </div>
    </template>
    <template v-else-if="showHistory">
      <div class="ai-panel-scroll">
        <section class="ai-section">
          <div class="ai-section-heading">
            <h3>会话历史</h3>
            <span>{{ totalConversations }}</span>
          </div>
          <div v-if="loading && !conversations.length" class="ai-empty">
            正在读取...
          </div>
          <div v-else-if="!conversations.length" class="ai-empty">暂无会话</div>
          <div v-else class="ai-history-list">
            <button
              v-for="conversation in conversations"
              :key="conversation.id"
              type="button"
              class="ai-history-row"
              :class="{ active: currentConversation?.id === conversation.id }"
              @click="openConversation(conversation.id)"
            >
              <span class="truncate">{{ conversation.rootGoal }}</span
              ><span class="ai-history-meta"
                ><span
                  :class="
                    conversation.status === 'frozen'
                      ? 'ai-status warning'
                      : statusTone(conversation.latestTurn?.status)
                  "
                  >{{
                    conversation.status === "frozen"
                      ? "版本已冻结"
                      : statusLabel(conversation.latestTurn?.status)
                  }}</span
                ><time>{{ formatDate(conversation.updatedAt) }}</time></span
              >
            </button>
          </div>
          <button
            v-if="conversations.length < totalConversations"
            class="ai-command secondary w-full mb-2"
            type="button"
            :disabled="loading"
            @click="loadConversationPage()"
          >
            加载更多
          </button>
          <button
            class="ai-command secondary w-full"
            type="button"
            @click="startNewConversation"
          >
            新建会话
          </button>
        </section>
      </div>
    </template>
    <template v-else-if="!currentConversation">
      <div class="ai-panel-scroll ai-new-conversation" />
      <ConversationComposer
        v-model:message="message"
        v-model:budget="budgetSelection"
        :budget-config="budgetConfig"
        :reader-focus="readerFocus"
        is-first-turn
        :disabled="creating || budgetConfigLoading"
        :budget-valid="budgetSelectionValid"
        :creating="creating"
        @submit="submitMessage"
      />
    </template>
    <template v-else>
      <div class="conversation-context">
        <div class="min-w-0">
          <span>{{
            currentConversation.status === "frozen" ? "已冻结会话" : "单书会话"
          }}</span
          ><strong>{{ currentConversation.rootGoal }}</strong>
        </div>
        <button
          v-if="!currentTurnActive"
          class="ai-icon-button"
          type="button"
          title="删除会话"
          :disabled="mutating"
          @click="removeConversation"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="m19 6-1 14H6L5 6" />
          </svg>
        </button>
      </div>
      <div class="ai-panel-scroll">
        <ConversationTurnList
          :turns="turns"
          :selected-turn-id="currentTurn?.id"
          :events="events"
          :has-older="olderTurnsAvailable"
          :loading="loading"
          @select="selectTurn"
          @retry="retryById"
          @load-older="loadOlderTurns"
          @citation="handleCitation"
        />
        <div
          v-if="displayCitationMessage"
          class="ai-citation-message"
          role="status"
        >
          {{ displayCitationMessage }}
        </div>
        <div v-if="error || budgetConfigError" class="ai-error" role="alert">
          {{ error || budgetConfigError }}
        </div>
      </div>
      <ConversationComposer
        v-model:message="message"
        v-model:budget="budgetSelection"
        :budget-config="budgetConfig"
        :reader-focus="readerFocus"
        :active="currentTurnActive"
        :frozen="currentConversationFrozen"
        :needs-input="currentTurn?.status === 'needs_input'"
        :clarification-question="currentTurn?.clarificationQuestion"
        :disabled="creating || mutating"
        :budget-valid="budgetSelectionValid"
        :creating="creating"
        :mutating="mutating"
        @submit="submitMessage"
        @cancel="cancelTurn"
        @new-conversation="startNewConversation"
      />
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  createBudgetSelection,
  validateBudgetSelection,
} from "../features/ai-reading/domain/budget";
import { useReadingConversation } from "../composables/useReadingConversation";
import { useBookAnalysis } from "../composables/useBookAnalysis";
import { isBookAnalysisReady } from "../features/metadata/domain/analysisState";
import type {
  ReadingBudgetSelection,
  ReadingEvidence,
  ReadingReaderFocus,
  ReadingTaskStatus,
} from "../features/ai-reading/model/aiReading";
import ConversationComposer from "./ai-reading/ConversationComposer.vue";
import ConversationTurnList from "./ai-reading/ConversationTurnList.vue";

const props = defineProps<{
  bookId: number;
  bookTitle: string;
  citationMessage?: string | null;
  readerFocus?: ReadingReaderFocus;
}>();
const emit = defineEmits<{
  close: [];
  citation: [evidence: ReadingEvidence];
}>();
const message = ref("");
const budgetSelection = ref<ReadingBudgetSelection | null>(null);
const showHistory = ref(false);
const localCitationMessage = ref<string | null>(null);
const {
  analysis: bookAnalysis,
  loading: analysisLoading,
  analyzing: analysisAnalyzing,
  error: analysisError,
  refresh: refreshAnalysis,
  analyze: analyzeBook,
} = useBookAnalysis(computed(() => props.bookId));
const analysisReady = computed(() => isBookAnalysisReady(bookAnalysis.value));
const effectiveAnalysisStatus = computed(() =>
  bookAnalysis.value?.stale
    ? "stale"
    : (bookAnalysis.value?.status ?? "not_analyzed"),
);
const analysisGateMessage = computed(
  () =>
    (
      ({
        pending: "AI 预分析中",
        running: "AI 预分析中",
        failed: "AI 预分析失败",
        stale: "书籍内容已变化，需要重新进行 AI 预分析",
        unsupported: "当前书籍格式暂不支持 AI 预分析",
      }) as Record<string, string>
    )[effectiveAnalysisStatus.value] ?? "AI 预分析后才能开始自主阅读",
);
const analysisActionLabel = computed(
  () =>
    (
      ({
        pending: "刷新状态",
        running: "刷新状态",
        failed: "重新分析",
        stale: "重新分析",
        unsupported: "",
      }) as Record<string, string>
    )[effectiveAnalysisStatus.value] ?? "对此书进行 AI 预分析",
);
const {
  conversations,
  totalConversations,
  currentConversation,
  currentConversationFrozen,
  canNavigateCitation,
  turns,
  currentTurn,
  currentTurnActive,
  events,
  olderTurnsAvailable,
  budgetConfig,
  budgetConfigLoading,
  budgetConfigError,
  loading,
  creating,
  mutating,
  error,
  loadConversationPage,
  selectConversation,
  selectTurn,
  loadOlderTurns,
  startConversation,
  sendTurn,
  retryTurn,
  cancelTurn,
  deleteConversation,
  clearSelection,
  refresh,
} = useReadingConversation(
  computed(() => props.bookId),
  {
    canCreateConversation: () => analysisReady.value,
    createBlockedMessage: "请先完成有效的 AI 预分析",
  },
);
watch(
  budgetConfig,
  (config) => {
    if (config && !budgetSelection.value)
      budgetSelection.value = createBudgetSelection(config);
  },
  { immediate: true },
);
const budgetSelectionValid = computed(() =>
  Boolean(
    budgetConfig.value &&
      budgetSelection.value &&
      Object.keys(
        validateBudgetSelection(budgetSelection.value, budgetConfig.value),
      ).length === 0,
  ),
);
const displayCitationMessage = computed(
  () => localCitationMessage.value || props.citationMessage || null,
);

async function submitMessage() {
  if (!budgetSelection.value || !budgetSelectionValid.value) return;
  const created = currentConversation.value
    ? await sendTurn(message.value, budgetSelection.value, props.readerFocus)
    : await startConversation(
        message.value,
        budgetSelection.value,
        props.readerFocus,
      );
  if (created) message.value = "";
}
async function handleAnalysisAction() {
  if (
    effectiveAnalysisStatus.value === "pending" ||
    effectiveAnalysisStatus.value === "running"
  )
    return refreshAnalysis();
  await analyzeBook({
    force:
      effectiveAnalysisStatus.value === "failed" ||
      effectiveAnalysisStatus.value === "stale",
  });
}
function startNewConversation() {
  showHistory.value = false;
  clearSelection();
  message.value = "";
  localCitationMessage.value = null;
}
async function openConversation(id: string) {
  showHistory.value = false;
  localCitationMessage.value = null;
  await selectConversation(id);
}
async function retryById(turnId: string) {
  const turn = turns.value.find((item) => item.id === turnId);
  if (turn) await retryTurn(turn);
}
async function removeConversation() {
  if (
    !currentConversation.value ||
    !window.confirm("删除整段会话及其所有轮次、事件和证据？")
  )
    return;
  await deleteConversation();
}
function handleCitation(evidence: ReadingEvidence) {
  if (!canNavigateCitation.value) {
    localCitationMessage.value =
      "书籍内容版本已变化，保留证据摘录但不向新版正文定位。";
    return;
  }
  localCitationMessage.value = null;
  emit("citation", evidence);
}
function statusLabel(status?: ReadingTaskStatus) {
  if (!status) return "暂无轮次";
  return {
    queued: "排队中",
    running: "阅读中",
    completed: "已完成",
    partial: "部分完成",
    needs_input: "待澄清",
    failed: "失败",
    cancelled: "已停止",
  }[status];
}
function statusTone(status?: ReadingTaskStatus) {
  if (status === "completed") return "ai-status success";
  if (status === "running" || status === "queued") return "ai-status active";
  if (status === "partial" || status === "needs_input")
    return "ai-status warning";
  return "ai-status danger";
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}
</script>

<style scoped>
.ai-reading-panel {
  top: var(--rd-bar-top, 0);
  bottom: var(--rd-bar-bottom, 0);
  width: min(560px, 100vw);
  display: flex;
  flex-direction: column;
  box-shadow: -12px 0 30px rgba(15, 23, 42, 0.06);
}
.ai-panel-header,
.conversation-context {
  flex: 0 0 auto;
  border-bottom: 1px solid var(--rd-divider);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.ai-panel-header {
  min-height: 64px;
  padding: 14px 16px;
}
.ai-panel-header h2 {
  margin: 2px 0 0;
  font-size: 16px;
  font-weight: 650;
  color: var(--rd-title);
}
.ai-eyebrow {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 9px;
  font-weight: 650;
  color: var(--rd-muted);
}
.ai-icon-button {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  display: inline-grid;
  place-items: center;
  border-radius: 6px;
  color: var(--rd-muted);
}
.ai-icon-button:hover {
  color: var(--rd-fg);
  background: var(--rd-hover-bg);
}
.ai-icon-button:disabled {
  opacity: 0.4;
}
.ai-panel-scroll {
  min-height: 0;
  overflow-y: auto;
  flex: 1;
  scroll-behavior: smooth;
}
.ai-new-conversation {
  display: flex;
  flex-direction: column;
}
.conversation-context {
  padding: 9px 18px;
}
.conversation-context span,
.conversation-context strong {
  display: block;
}
.conversation-context span {
  color: var(--rd-muted);
  font-size: 8px;
}
.conversation-context strong {
  max-width: 430px;
  margin-top: 2px;
  color: var(--rd-title);
  font-size: 10px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-section {
  padding: 18px 18px 20px;
  border-bottom: 1px solid var(--rd-divider);
}
.ai-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.ai-section-heading h3 {
  margin: 0;
  color: var(--rd-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.ai-section-heading > span {
  color: var(--rd-muted-strong);
  font-size: 10px;
}
.ai-analysis-gate p,
.ai-start-copy {
  margin: 0;
  color: var(--rd-fg);
  font-size: 12px;
  line-height: 1.65;
}
.ai-start-copy {
  color: var(--rd-muted-strong);
}
.ai-command {
  min-height: 34px;
  padding: 8px 13px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 750;
}
.ai-command.primary {
  color: var(--rd-accent-fg);
  background: var(--rd-accent);
}
.ai-command.secondary {
  color: var(--rd-fg);
  border: 1px solid var(--rd-border);
  background: var(--rd-chip-bg);
}
.ai-command:disabled {
  opacity: 0.45;
}
.ai-status {
  font-size: 9px;
  font-weight: 800;
  white-space: nowrap;
}
.ai-status.success {
  color: #16a34a;
}
.ai-status.active {
  color: #2563eb;
}
.ai-status.warning {
  color: #d97706;
}
.ai-status.danger {
  color: #dc2626;
}
.ai-history-list {
  display: grid;
  margin-bottom: 14px;
}
.ai-history-row {
  padding: 11px 8px;
  border-bottom: 1px solid var(--rd-divider);
  text-align: left;
  color: var(--rd-fg);
  font-size: 12px;
}
.ai-history-row.active {
  background: var(--rd-chip-bg);
}
.ai-history-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 6px;
  color: var(--rd-muted);
  font-size: 9px;
}
.ai-empty {
  padding: 22px 0;
  color: var(--rd-muted);
  text-align: center;
  font-size: 11px;
}
.ai-error {
  margin: 16px 18px;
  padding: 10px;
  border-left: 3px solid #dc2626;
  background: rgba(239, 68, 68, 0.08);
  color: #dc2626;
  font-size: 11px;
  line-height: 1.5;
}
.ai-citation-message {
  margin: 14px 18px;
  padding: 9px 11px;
  border: 1px solid var(--rd-border);
  border-radius: 6px;
  color: var(--rd-fg);
  background: var(--rd-chip-bg);
  font-size: 10px;
}
@media (max-width: 640px) {
  .ai-reading-panel {
    width: 100%;
  }
  .conversation-context strong {
    max-width: calc(100vw - 90px);
  }
}
</style>
