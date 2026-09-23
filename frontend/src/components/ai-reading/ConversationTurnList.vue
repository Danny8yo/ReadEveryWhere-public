<template>
  <div class="turn-stream" aria-label="会话记录">
    <button v-if="hasOlder" class="load-older" type="button" :disabled="loading" @click="emit('load-older')">
      {{ loading ? '正在读取...' : '查看更早对话' }}
    </button>
    <div v-if="!turns.length" class="turn-empty">还没有对话</div>
    <article v-for="turn in turns" :key="turn.id" class="turn" :class="{ selected: selectedTurnId === turn.id }" :data-turn-id="turn.id">
      <div class="user-message-row">
        <div class="turn-user">
          <div class="turn-user-head">
            <button class="turn-select" type="button" :aria-label="`查看第 ${turn.turnNumber} 轮过程`" @click="emit('select', turn.id)">你 · 第 {{ turn.turnNumber }} 轮</button>
            <button
              class="turn-user-copy"
              type="button"
              :aria-label="copiedTurnId === turn.id ? '已复制' : `复制第 ${turn.turnNumber} 轮问题`"
              :title="copiedTurnId === turn.id ? '已复制' : '复制我的问题'"
              @click="copyUserInput(turn)"
            >
              <svg v-if="copiedTurnId === turn.id" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
              <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="1" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>
            </button>
          </div>
          <p class="turn-user-text">{{ turn.userInput }}</p>
        </div>
      </div>

      <div class="assistant-message">
        <div class="assistant-heading">
          <span class="assistant-mark" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 9.8 8.8 4 11l5.8 2.2L12 19l2.2-5.8L20 11l-5.8-2.2L12 3Z" /></svg></span>
          <strong>阅读助手</strong><span class="turn-status" :class="statusTone(turn.status)">{{ statusLabel(turn.status) }}</span>
        </div>

        <aside v-if="turn.retrySource" class="retry-source" aria-label="重试来源">
          <strong>来源轮{{ turn.retrySource.sourceStatus === 'failed' ? '失败' : '已停止' }}：{{ turn.retrySource.failureCode }}</strong>
          <ul v-if="turn.retrySource.evidenceCandidates.length"><li v-for="candidate in turn.retrySource.evidenceCandidates" :key="candidate.sourceEvidenceId"><span v-if="candidate.chapterPath">{{ candidate.chapterPath }}</span><q>{{ candidate.quotePreview }}</q></li></ul>
        </aside>

        <TurnProcessDisclosure v-if="selectedTurnId === turn.id && turn.task && isActive(turn.status)" :events="events" :agents="turn.task.agents" :status="turn.task.status" :budget="turn.task.budget" />

        <div v-if="answerFor(turn)?.text" class="answer-prose" :class="{ streaming: answerFor(turn)?.phase === 'streaming' }">
          {{ answerFor(turn)?.text }}<span v-if="answerFor(turn)?.phase === 'streaming'" class="stream-caret" aria-hidden="true" />
        </div>
        <p v-else-if="turn.status === 'queued' || turn.status === 'running'" class="turn-pending"><span class="pending-dot" aria-hidden="true" />{{ answerFor(turn)?.phase === 'started' ? '正在组织回答' : '正在阅读并核对证据' }}</p>
        <p v-else-if="turn.status === 'needs_input'" class="turn-clarification">{{ turn.clarificationQuestion || '需要补充信息才能继续。' }}</p>

        <details v-if="turn.task?.result && answerFor(turn)?.text" class="answer-support">
          <summary>查看引用与结构化依据</summary>
          <ResultGroup title="书内发现" :items="turn.task.result.bookFindings" :evidence-by-id="evidenceFor(turn)" @citation="emit('citation', $event)" />
          <ResultGroup title="证据推断" :items="turn.task.result.inferences" :evidence-by-id="evidenceFor(turn)" @citation="emit('citation', $event)" />
          <ResultGroup title="模型背景知识" :items="turn.task.result.modelKnowledge" :evidence-by-id="evidenceFor(turn)" @citation="emit('citation', $event)" />
          <TextResultGroup title="未决问题" :items="turn.task.result.openQuestions" /><TextResultGroup title="限制" :items="turn.task.result.limitations" />
        </details>

        <p v-if="['failed', 'cancelled'].includes(turn.status)" class="turn-failed">{{ turn.status === 'failed' ? '本轮未能完成。' : '本轮已停止。' }}<button type="button" @click="emit('retry', turn.id)">重试</button></p>
        <TurnProcessDisclosure v-if="selectedTurnId === turn.id && turn.task && !isActive(turn.status)" :events="events" :agents="turn.task.agents" :status="turn.task.status" :budget="turn.task.budget" />
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import type { ReadingConversationTurnDetail, ReadingEvent, ReadingEvidence, ReadingTaskStatus } from '../../features/ai-reading/model/aiReading';
import { evidenceMap, streamedAnswer } from '../../features/ai-reading/domain/state';
import ResultGroup from './ResultGroup.vue';
import TextResultGroup from './TextResultGroup.vue';
import TurnProcessDisclosure from './TurnProcessDisclosure.vue';

const props = withDefaults(defineProps<{ turns: ReadingConversationTurnDetail[]; selectedTurnId?: string; events?: ReadingEvent[]; hasOlder?: boolean; loading?: boolean }>(), { events: () => [] });
const emit = defineEmits<{ select: [turnId: string]; retry: [turnId: string]; citation: [evidence: ReadingEvidence]; 'load-older': [] }>();
const copiedTurnId = ref<string | null>(null);
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

onBeforeUnmount(() => { if (copyResetTimer) clearTimeout(copyResetTimer); });

async function copyUserInput(turn: ReadingConversationTurnDetail) {
  try {
    await navigator.clipboard.writeText(turn.userInput);
    copiedTurnId.value = turn.id;
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => { copiedTurnId.value = null; }, 1_500);
  } catch {
    copiedTurnId.value = null;
  }
}

function answerFor(turn: ReadingConversationTurnDetail) {
  if (props.selectedTurnId === turn.id) { const live = streamedAnswer(props.events); if (live) return live; }
  const result = turn.task?.result;
  const text = result?.answerText || (result ? structuredAnswer(result) : '');
  return text ? { answerId: `${turn.id}:stored`, text, phase: 'completed' as const, mode: 'model' as const, evidenceIds: [] } : null;
}
function structuredAnswer(result: NonNullable<ReadingConversationTurnDetail['task']>['result']) {
  if (!result) return '';
  const sections: string[] = [];
  const add = (title: string, values: string[]) => { if (values.length) sections.push(`${title}\n${values.map((value) => `- ${value}`).join('\n')}`); };
  add('书内结论', result.bookFindings.map((item) => item.statement));
  add('基于证据的推断', result.inferences.map((item) => item.statement));
  add('补充背景', result.modelKnowledge.map((item) => item.statement));
  add('仍待确认', result.openQuestions.map(textOf));
  add('回答限制', result.limitations.map(textOf));
  return sections.join('\n\n');
}
function textOf(value: string | { statement: string }) { return typeof value === 'string' ? value : value.statement; }
function evidenceFor(turn: ReadingConversationTurnDetail) {
  if (!turn.task) return new Map<string, ReadingEvidence>();
  const merged = evidenceMap(turn.task.result?.evidence);
  for (const [id, evidence] of evidenceMap(turn.task.evidence)) merged.set(id, evidence);
  return merged;
}
function isActive(status: ReadingTaskStatus) { return status === 'queued' || status === 'running'; }
function statusLabel(status: ReadingTaskStatus) { return ({ queued: '排队中', running: '阅读中', completed: '已完成', partial: '部分完成', needs_input: '待澄清', failed: '失败', cancelled: '已停止' } as Record<ReadingTaskStatus, string>)[status]; }
function statusTone(status: ReadingTaskStatus) { if (status === 'completed') return 'success'; if (status === 'queued' || status === 'running') return 'active'; if (status === 'partial' || status === 'needs_input') return 'warning'; return 'danger'; }
</script>

<style scoped>
.turn-stream { padding: 8px 20px 28px; }.load-older { width: 100%; padding: 10px; color: var(--rd-accent); font-size: 10px; }.turn-empty { padding: 32px 0; color: var(--rd-muted); text-align: center; font-size: 11px; }.turn { padding: 16px 0 24px; border-bottom: 1px solid var(--rd-divider); }.turn:last-child { border-bottom: 0; }
.user-message-row { display: flex; justify-content: flex-end; }.turn-user { width: fit-content; max-width: 86%; padding: 8px 10px 10px 12px; border-radius: 7px 7px 2px 7px; background: var(--rd-chip-bg); text-align: left; }.turn-user-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }.turn-select { color: var(--rd-muted); font-size: 8px; }.turn-select:focus-visible,.turn-user-copy:focus-visible { outline: 2px solid var(--rd-accent); outline-offset: 2px; }.turn-user-copy { width: 24px; height: 24px; flex: 0 0 24px; display: grid; place-items: center; border-radius: 4px; color: var(--rd-muted); }.turn-user-copy:hover { color: var(--rd-fg); background: var(--rd-hover-bg); }.turn-user-text { margin: 0; color: var(--rd-title); font-size: 12px; font-weight: 600; line-height: 1.55; overflow-wrap: anywhere; user-select: text; cursor: text; }
.assistant-message { margin-top: 18px; }.assistant-heading { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; }.assistant-mark { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 5px; color: #fff; background: #18181b; }.assistant-heading > strong { color: var(--rd-title); font-size: 10px; }.turn-status { margin-left: auto; font-size: 8px; font-weight: 750; }.turn-status.success { color: #15803d; }.turn-status.active { color: #2563eb; }.turn-status.warning { color: #b45309; }.turn-status.danger { color: #b91c1c; }
.answer-prose { color: var(--rd-fg); font-size: 12px; line-height: 1.78; white-space: pre-wrap; overflow-wrap: anywhere; }.stream-caret { width: 2px; height: 1.05em; display: inline-block; margin-left: 2px; vertical-align: -.12em; background: var(--rd-accent); animation: caret-blink .85s step-end infinite; }.turn-pending,.turn-clarification,.turn-failed { margin: 0; color: var(--rd-muted-strong); font-size: 11px; line-height: 1.55; }.turn-pending { display: flex; align-items: center; gap: 8px; }.pending-dot { width: 7px; height: 7px; border-radius: 50%; background: #2563eb; animation: pending-pulse 1.35s ease-in-out infinite; }.turn-clarification { color: #b45309; }.turn-failed { color: #b91c1c; }.turn-failed button { margin-left: 6px; color: var(--rd-accent); font-weight: 750; }
.retry-source { margin: 0 0 12px 31px; padding: 8px 0 8px 10px; border-left: 2px solid #d97706; color: var(--rd-muted-strong); font-size: 9px; line-height: 1.5; overflow-wrap: anywhere; }.retry-source strong { display: block; color: var(--rd-title); }.retry-source ul { display: grid; gap: 5px; margin: 6px 0 0; padding: 0; list-style: none; }.retry-source li { display: grid; gap: 2px; }.retry-source span { color: var(--rd-muted); }.retry-source q { quotes: none; }.answer-support { margin-top: 14px; border-top: 1px solid var(--rd-divider); }.answer-support > summary { padding: 10px 0; cursor: pointer; color: var(--rd-accent); font-size: 9px; font-weight: 700; }
@keyframes caret-blink { 0%,45% { opacity: 1; } 46%,100% { opacity: 0; } } @keyframes pending-pulse { 0%,100% { opacity: .35; transform: scale(.75); } 50% { opacity: 1; transform: scale(1); } } @media (prefers-reduced-motion: reduce) { .stream-caret,.pending-dot { animation: none; } }
</style>
