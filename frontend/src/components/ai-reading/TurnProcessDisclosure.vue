<template>
  <section class="run-disclosure" :class="{ active: isActive }" aria-label="过程摘要">
    <button
      class="run-toggle"
      type="button"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span class="run-state" :class="{ pulse: isActive }" aria-hidden="true">
        <svg v-if="!isActive" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m5 12 4 4L19 6" /></svg>
      </span>
      <span class="run-toggle-copy">
        <strong>过程摘要</strong>
        <small>{{ processSummary }}</small>
      </span>
      <span class="run-toggle-action">{{ expanded ? '隐藏过程' : '查看过程' }}</span>
      <svg class="run-chevron" :class="{ expanded }" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
    </button>

    <div v-if="expanded" class="run-body">
      <div v-if="latestActivity" class="run-current" role="status">
        <span class="activity-dot" :class="{ pulse: isActive }" aria-hidden="true" />
        <div><strong>{{ latestActivity.payload.title }}</strong><p v-if="latestActivity.payload.summary">{{ latestActivity.payload.summary }}</p></div>
      </div>

      <ol v-if="agents.length" class="agent-list" aria-label="Agent 运行情况">
        <li v-for="agent in agents" :key="agent.id" :style="{ '--depth': agent.depth ?? 0 }">
          <span class="agent-branch" aria-hidden="true">{{ agent.parentRunId ? '↳' : 'A' }}</span>
          <div><strong>{{ agent.goal }}</strong><small v-if="agent.deliverable">{{ agent.deliverable }}</small></div>
          <span class="row-status" :class="statusTone(agent.status)">{{ agentStatus(agent.status) }}</span>
        </li>
      </ol>

      <ol v-if="executionItems.length" class="execution-list" aria-label="Agent 执行记录">
        <li v-for="entry in executionItems" :key="entry.key" :class="`${entry.kind}-row`">
          <div v-if="entry.kind === 'commentary'" class="commentary-entry">
            <span class="commentary-mark" aria-hidden="true" />
            <div>
              <strong>{{ entry.event.payload.title }}</strong>
              <p>{{ commentaryText(entry.event) }}</p>
            </div>
          </div>

          <details v-else-if="entry.kind === 'tool'" :open="entry.item.status === 'running'">
            <summary>
              <span class="tool-icon" :class="`status-${entry.item.status}`" aria-hidden="true">
                <svg v-if="entry.item.status === 'completed'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m5 12 4 4L19 6" /></svg>
                <svg v-else-if="entry.item.status === 'failed' || entry.item.status === 'interrupted'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.3 3.8 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" /></svg>
                <span v-else class="activity-dot pulse" />
              </span>
              <span class="tool-copy"><strong>{{ toolName(entry.item) }}</strong><small>{{ entry.item.summary || entry.item.title }}</small></span>
              <span class="row-status" :class="`status-${entry.item.status}`">{{ toolStatus(entry.item.status) }}</span>
              <svg class="detail-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            </summary>
            <div class="tool-detail">
              <p v-if="toolPurpose(entry.item)">{{ toolPurpose(entry.item) }}</p>
              <dl v-if="toolFields(entry.item).length">
                <template v-for="field in toolFields(entry.item)" :key="field.label">
                  <dt>{{ field.label }}</dt><dd>{{ field.value }}</dd>
                </template>
              </dl>
            </div>
          </details>

          <div v-else class="public-step-entry">
            <span>#{{ entry.event.sequence }}</span>
            <div><strong>{{ entry.event.payload.title }}</strong><p v-if="entry.event.payload.summary">{{ entry.event.payload.summary }}</p></div>
          </div>
        </li>
      </ol>

      <div v-if="budgetRows.length" class="run-budget" aria-label="本轮预算">
        <span v-for="row in budgetRows" :key="row.label"><strong>{{ row.value }}</strong>{{ row.label }}</span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { groupReadingEvents } from '../../features/ai-reading/domain/state';
import type {
  ReadingAgentRun,
  ReadingAgentRunStatus,
  ReadingBudget,
  ReadingEvent,
  ReadingTaskStatus,
} from '../../features/ai-reading/model/aiReading';
import type { ReadingEventTimelineItem } from '../../features/ai-reading/domain/state';

const props = defineProps<{
  events: ReadingEvent[];
  agents: ReadingAgentRun[];
  status: ReadingTaskStatus;
  budget?: ReadingBudget;
}>();

const isActive = computed(() => props.status === 'queued' || props.status === 'running');
const expanded = ref(isActive.value);
const toolItems = computed(() => groupReadingEvents(props.events, props.status).filter((item) => (
  item.events.some((event) => event.payload.kind === 'tool')
)));
const commentaryEvents = computed(() => props.events.filter((event) => (
  event.payload.schemaVersion === 2 && event.payload.kind === 'commentary'
)));
const evidenceCount = computed(() => new Set(props.events.filter((event) => event.evidenceId).map((event) => event.evidenceId)).size);
const cacheHitRatio = computed(() => {
  const hit = props.budget?.used.cacheReadInputTokens;
  const miss = props.budget?.used.uncachedInputTokens;
  if (typeof hit !== 'number' || typeof miss !== 'number' || hit + miss <= 0) return null;
  return hit / (hit + miss);
});
const processSummary = computed(() => {
  const values = [];
  if (props.agents.length) values.push(`${props.agents.length} 个 Agent`);
  if (commentaryEvents.value.length) values.push(`${commentaryEvents.value.length} 条说明`);
  if (toolItems.value.length) values.push(`${toolItems.value.length} 次工具`);
  if (evidenceCount.value) values.push(`${evidenceCount.value} 条证据`);
  if (typeof props.budget?.used.totalTokens === 'number') {
    values.push(`${compactTokenNumber(props.budget.used.totalTokens)} Token`);
    values.push(`缓存 ${cacheHitRatio.value === null ? '未报告' : formatRatio(cacheHitRatio.value)}`);
  }
  return values.join(' · ') || (isActive.value ? '正在准备' : '没有额外过程记录');
});
const latestActivity = computed(() => [...props.events].reverse().find((event) => !['answer', 'budget'].includes(event.payload.kind)) ?? null);
const publicSteps = computed(() => props.events.filter((event) => (
  event.payload.schemaVersion === 2
  && ['plan', 'recovery', 'task'].includes(event.payload.kind)
)).slice(-12));
type ExecutionItem =
  | { kind: 'commentary'; key: string; sequence: number; event: ReadingEvent }
  | { kind: 'tool'; key: string; sequence: number; item: ReadingEventTimelineItem }
  | { kind: 'step'; key: string; sequence: number; event: ReadingEvent };
const executionItems = computed<ExecutionItem[]>(() => [
  ...commentaryEvents.value.map((event): ExecutionItem => ({
    kind: 'commentary', key: `commentary:${event.sequence}`, sequence: event.sequence, event,
  })),
  ...toolItems.value.map((item): ExecutionItem => ({
    kind: 'tool', key: item.key, sequence: item.startSequence, item,
  })),
  ...publicSteps.value.map((event): ExecutionItem => ({
    kind: 'step', key: `step:${event.sequence}`, sequence: event.sequence, event,
  })),
].sort((left, right) => left.sequence - right.sequence));
const budgetRows = computed(() => {
  if (!props.budget) return [];
  const rows: Array<{ label: string; value: string | number }> = [
    { label: '模型轮次', value: props.budget.used.modelTurns },
    { label: '工具调用', value: props.budget.used.toolCalls },
    { label: '阅读字符', value: compactNumber(props.budget.used.readCharacters) },
  ];
  const usage = props.budget.used;
  const hasTokenUsage = [usage.promptTokens, usage.completionTokens, usage.totalTokens]
    .some((value) => typeof value === 'number');
  if (!hasTokenUsage) return rows;
  rows.push(
    { label: '输入 Token', value: reportedToken(usage.promptTokens) },
    { label: '输出 Token', value: reportedToken(usage.completionTokens) },
    { label: '总 Token', value: reportedToken(usage.totalTokens) },
    { label: '缓存命中', value: reportedToken(usage.cacheReadInputTokens) },
    { label: '缓存未命中', value: reportedToken(usage.uncachedInputTokens) },
    { label: '命中率', value: cacheHitRatio.value === null ? '未报告' : formatRatio(cacheHitRatio.value) },
    { label: '缓存写入', value: reportedToken(usage.cacheWriteInputTokens) },
  );
  return rows;
});

function toolEvent(item: ReadingEventTimelineItem) {
  return item.events.find((event) => event.payload.kind === 'tool') ?? item.events[0];
}
function commentaryText(event: ReadingEvent) {
  if (event.payload.schemaVersion !== 2) return event.payload.summary || '';
  const detail = event.payload.detail as Record<string, unknown>;
  return typeof detail.text === 'string' ? detail.text : event.payload.summary || '';
}
function toolName(item: ReadingEventTimelineItem) {
  const event = toolEvent(item);
  return event.payload.toolName || event.payload.title.replace(/^(调用|开始使用)\s*/u, '');
}
function toolPurpose(item: ReadingEventTimelineItem) {
  for (const event of item.events) {
    if (event.payload.schemaVersion !== 2 || event.payload.kind !== 'tool') continue;
    const value = (event.payload.detail as Record<string, unknown>).purpose;
    if (typeof value === 'string') return value;
  }
  return '';
}
function toolFields(item: ReadingEventTimelineItem) {
  const fields: Array<{ label: string; value: string }> = [];
  for (const event of item.events) {
    if (event.payload.schemaVersion !== 2 || event.payload.kind !== 'tool') continue;
    const detail = event.payload.detail as Record<string, unknown>;
    if (detail.arguments && typeof detail.arguments === 'object') fields.push({ label: '参数', value: displayValue(detail.arguments) });
    if (detail.result && typeof detail.result === 'object') fields.push({ label: '结果', value: displayValue(detail.result) });
    if (typeof detail.durationMs === 'number') fields.push({ label: '耗时', value: `${detail.durationMs} ms` });
    if (typeof detail.errorCode === 'string') fields.push({ label: '错误', value: detail.errorCode });
  }
  return fields.slice(-4);
}
function displayValue(value: unknown) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return '已记录'; }
}
function toolStatus(status: ReadingEventTimelineItem['status']) {
  return ({ running: '运行中', completed: '完成', failed: '失败', interrupted: '中断', recorded: '已记录' })[status];
}
function agentStatus(status: ReadingAgentRunStatus) {
  return ({ queued: '排队', running: '运行中', waiting_children: '等待', completed: '完成', partial: '部分完成', needs_input: '待澄清', failed: '失败', cancelled: '停止' })[status];
}
function statusTone(status: ReadingAgentRunStatus) {
  if (status === 'completed') return 'status-completed';
  if (['queued', 'running', 'waiting_children'].includes(status)) return 'status-running';
  return 'status-failed';
}
function compactNumber(value: number) {
  return value >= 10_000 ? `${Math.round(value / 1_000)}k` : new Intl.NumberFormat('zh-CN').format(value);
}
function compactTokenNumber(value: number) {
  if (value < 1_000) return new Intl.NumberFormat('zh-CN').format(value);
  return `${(value / 1_000).toFixed(1)}k`;
}
function reportedToken(value: number | null | undefined) {
  return typeof value === 'number' ? compactTokenNumber(value) : '未报告';
}
function formatRatio(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}
</script>

<style scoped>
.run-disclosure { margin: 14px 0 2px; border-top: 1px solid var(--rd-divider); border-bottom: 1px solid var(--rd-divider); }
.run-toggle { width: 100%; min-height: 46px; display: flex; align-items: center; gap: 9px; padding: 8px 2px; text-align: left; }
.run-toggle:focus-visible { outline: 2px solid var(--rd-accent); outline-offset: 2px; }
.run-state { width: 20px; height: 20px; flex: 0 0 20px; display: grid; place-items: center; border: 1px solid var(--rd-border); border-radius: 50%; color: #15803d; }
.run-state.pulse { border: 0; background: #2563eb; box-shadow: 0 0 0 4px rgba(37,99,235,.1); }
.run-toggle-copy { min-width: 0; flex: 1; }.run-toggle-copy strong,.run-toggle-copy small { display: block; }.run-toggle-copy strong { color: var(--rd-title); font-size: 11px; }.run-toggle-copy small { margin-top: 2px; color: var(--rd-muted); font-size: 9px; }
.run-toggle-action { color: var(--rd-accent); font-size: 9px; font-weight: 700; }.run-chevron { color: var(--rd-muted); transition: transform .16s ease; }.run-chevron.expanded { transform: rotate(90deg); }
.run-body { padding: 2px 0 10px 29px; }.run-current { display: flex; gap: 9px; padding: 9px 0 11px; }.run-current > div { min-width: 0; }.run-current strong { color: var(--rd-fg); font-size: 10px; }.run-current p { margin: 2px 0 0; color: var(--rd-muted); font-size: 9px; line-height: 1.5; overflow-wrap: anywhere; }
.activity-dot { width: 7px; height: 7px; flex: 0 0 7px; margin-top: 5px; border-radius: 50%; background: #64748b; }.activity-dot.pulse { background: #2563eb; animation: process-pulse 1.35s ease-in-out infinite; }
.agent-list,.execution-list { margin: 0; padding: 0; list-style: none; }.agent-list { border-top: 1px solid var(--rd-divider); }.agent-list li { display: grid; grid-template-columns: 22px minmax(0,1fr) auto; gap: 7px; align-items: start; padding: 9px 0 9px calc(var(--depth) * 12px); border-bottom: 1px solid var(--rd-divider); }.agent-branch { color: var(--rd-muted); font-size: 9px; font-weight: 800; }.agent-list strong,.agent-list small { display: block; overflow-wrap: anywhere; }.agent-list strong { color: var(--rd-fg); font-size: 10px; line-height: 1.45; }.agent-list small { margin-top: 2px; color: var(--rd-muted); font-size: 8px; line-height: 1.45; }
.row-status { align-self: center; white-space: nowrap; color: var(--rd-muted); font-size: 8px; font-weight: 700; }.status-completed { color: #15803d; }.status-running { color: #2563eb; }.status-failed { color: #b91c1c; }
.execution-list { border-top: 1px solid var(--rd-divider); }.execution-list > li { border-bottom: 1px solid var(--rd-divider); }.execution-list details > summary { min-height: 48px; display: grid; grid-template-columns: 22px minmax(0,1fr) auto 16px; gap: 7px; align-items: center; cursor: pointer; list-style: none; }.execution-list summary::-webkit-details-marker { display: none; }.tool-icon { width: 20px; height: 20px; display: grid; place-items: center; border-radius: 4px; background: var(--rd-chip-bg); color: var(--rd-muted); }.tool-icon.status-completed { color: #15803d; }.tool-icon.status-failed,.tool-icon.status-interrupted { color: #b91c1c; }
.tool-copy { min-width: 0; }.tool-copy strong,.tool-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.tool-copy strong { color: var(--rd-title); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }.tool-copy small { margin-top: 2px; color: var(--rd-muted); font-size: 8px; }.detail-chevron { color: var(--rd-muted); transition: transform .16s ease; }.execution-list details[open] .detail-chevron { transform: rotate(90deg); }
.tool-detail { padding: 0 23px 10px 29px; color: var(--rd-muted-strong); font-size: 9px; }.tool-detail p { margin: 0 0 7px; line-height: 1.5; }.tool-detail dl { display: grid; grid-template-columns: 38px minmax(0,1fr); gap: 5px 8px; margin: 0; }.tool-detail dt { color: var(--rd-muted); }.tool-detail dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.45; overflow-wrap: anywhere; }
.commentary-entry { display: grid; grid-template-columns: 22px minmax(0,1fr); gap: 7px; padding: 10px 0; }.commentary-mark { width: 7px; height: 7px; margin: 5px 0 0 6px; border-radius: 50%; background: var(--rd-accent); }.commentary-entry strong { display: block; color: var(--rd-muted); font-size: 8px; }.commentary-entry p { margin: 3px 0 0; color: var(--rd-fg); font-size: 10px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.public-step-entry { display: grid; grid-template-columns: 24px minmax(0,1fr); gap: 6px; padding: 8px 0; color: var(--rd-muted); font-size: 8px; }.public-step-entry strong { color: var(--rd-fg); font-size: 9px; }.public-step-entry p { margin: 2px 0 0; line-height: 1.45; }
.run-budget { display: flex; flex-wrap: wrap; gap: 10px 16px; margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--rd-divider); color: var(--rd-muted); font-size: 8px; }.run-budget span { display: flex; gap: 4px; }.run-budget strong { color: var(--rd-fg); font-size: 9px; }
@keyframes process-pulse { 0%,100% { opacity: .45; transform: scale(.8); } 50% { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .activity-dot.pulse { animation: none; }.run-chevron,.detail-chevron { transition: none; } }
</style>
