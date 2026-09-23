<template>
  <ol class="ai-event-list" aria-label="探索过程公开事件">
    <li v-for="item in timelineItems" :key="item.key" class="ai-event-item">
      <div class="ai-event-rail" aria-hidden="true"><span :class="`status-${item.status}`" /></div>
      <details class="ai-event-disclosure">
        <summary>
          <div class="ai-event-summary-content">
            <div class="ai-event-meta">
              <span class="ai-agent-tag">{{ agentSummary(item.events) }}</span>
              <span>{{ sequenceLabel(item) }}</span>
              <time>{{ formatTime(item.createdAt) }}</time>
              <span class="ai-event-state" :class="`status-${item.status}`">{{ statusLabel(item.status) }}</span>
            </div>
            <div class="ai-event-title">{{ item.title }}</div>
            <p v-if="item.summary" class="ai-event-description">{{ item.summary }}</p>
          </div>
        </summary>

        <div class="ai-event-detail">
          <p v-if="isLegacy(item.events)" class="ai-event-legacy">历史事件未记录详细信息</p>

          <section v-if="toolPurpose(item.events)" class="ai-detail-section">
            <h4>目的</h4>
            <p>{{ toolPurpose(item.events) }}</p>
          </section>

          <section v-if="argumentEntries(item.events).length" class="ai-detail-section">
            <h4>清洗后的参数</h4>
            <dl class="ai-detail-fields">
              <template v-for="entry in argumentEntries(item.events)" :key="entry.key">
                <dt>{{ fieldLabel(entry.key) }}</dt>
                <dd>{{ displayValue(entry.value) }}</dd>
              </template>
            </dl>
          </section>

          <section v-for="plan in planDetails(item.events)" :key="`plan-${plan.event.sequence}`" class="ai-detail-section">
            <h4>计划变化</h4>
            <div v-if="plan.before.length" class="ai-plan-snapshot">
              <span>更新前</span>
              <ol>
                <li v-for="step in plan.before" :key="`before-${step.id}`">
                  <span>{{ step.title }}</span><small>{{ planStatusLabel(step.status) }}</small>
                </li>
              </ol>
            </div>
            <div class="ai-plan-snapshot current">
              <span>更新后</span>
              <ol>
                <li v-for="step in plan.after" :key="`after-${step.id}`">
                  <span>{{ step.title }}</span><small>{{ planStatusLabel(step.status) }}</small>
                </li>
              </ol>
            </div>
            <p v-if="plan.nextAction" class="ai-next-action"><strong>下一步</strong>{{ plan.nextAction }}</p>
          </section>

          <section v-if="agentLifecycle(item.events).length" class="ai-detail-section">
            <h4>Agent 归属</h4>
            <ul class="ai-agent-lifecycle">
              <li v-for="agent in agentLifecycle(item.events)" :key="`${agent.event.sequence}-${agent.event.agentRunId}`">
                <span>{{ agentLabel(agent.event.agentRunId) }}</span>
                <span class="ai-agent-goal">{{ agent.goal }}</span>
                <small>{{ agent.status }}</small>
              </li>
            </ul>
          </section>

          <section v-for="outcome in toolOutcomes(item.events)" :key="`result-${outcome.event.sequence}`" class="ai-detail-section">
            <h4>{{ outcome.failed ? '失败结果' : '结果摘要' }}</h4>
            <p v-if="outcome.summary">{{ outcome.summary }}</p>

            <blockquote v-if="outcome.excerpt" class="ai-reading-excerpt">{{ outcome.excerpt }}</blockquote>
            <ul v-if="outcome.unavailable.length" class="ai-scan-results">
              <li v-for="(unit, index) in outcome.unavailable" :key="`${outcome.event.sequence}-unavailable-${index}`">
                <strong>{{ unit.label }}</strong>
                <p>{{ unit.kind === 'own' ? '节点自身正文' : '节点子树' }} · {{ unit.characterCount }} 字符</p>
                <small>{{ unit.reason === 'TOC_NODE_TOO_LARGE' ? '无法按现有目录结构完整读取' : '没有可读正文' }}</small>
              </li>
            </ul>
            <button
              v-if="outcome.citation"
              class="ai-citation-action"
              type="button"
              @click="emitCitation(outcome.citation, outcome.excerpt, outcome.event)"
            >
              查看原文
            </button>

            <ul v-if="outcome.items.length" class="ai-scan-results">
              <li v-for="(resultItem, index) in outcome.items" :key="`${outcome.event.sequence}-${index}`">
                <strong>{{ resultItemTitle(resultItem, index) }}</strong>
                <p v-if="resultItemBody(resultItem)">{{ resultItemBody(resultItem) }}</p>
                <small v-if="resultItemMeta(resultItem)">{{ resultItemMeta(resultItem) }}</small>
                <button
                  v-if="readingCitation(resultItem.citation)"
                  class="ai-citation-action"
                  type="button"
                  @click="emitCitation(readingCitation(resultItem.citation)!, resultItemQuote(resultItem), outcome.event, index)"
                >
                  查看原文
                </button>
              </li>
            </ul>

            <ul v-if="outcome.delegates.length" class="ai-delegate-results">
              <li v-for="delegate in outcome.delegates" :key="String(delegate.agentRunId || delegate.subtaskId)">
                <strong>{{ String(delegate.goal || '阅读子任务') }}</strong>
                <span>{{ agentLabel(stringValue(delegate.agentRunId)) }}</span>
                <small>{{ publicStatusLabel(delegate.status) }}<template v-if="delegate.errorCode"> · {{ delegate.errorCode }}</template></small>
              </li>
            </ul>

            <dl v-if="outcome.boundaryEntries.length" class="ai-detail-fields compact">
              <template v-for="entry in outcome.boundaryEntries" :key="entry.key">
                <dt>{{ fieldLabel(entry.key) }}</dt><dd>{{ displayValue(entry.value) }}</dd>
              </template>
            </dl>
          </section>

          <section v-if="evidenceDetails(item.events).length" class="ai-detail-section">
            <h4>Evidence</h4>
            <div v-for="evidence in evidenceDetails(item.events)" :key="evidence.event.sequence" class="ai-evidence-row">
              <blockquote>{{ evidence.quote }}</blockquote>
              <span v-if="evidence.chapterPath">{{ evidence.chapterPath }}</span>
              <button
                v-if="evidence.citation"
                class="ai-citation-action"
                type="button"
                @click="emitCitation(evidence.citation, evidence.quote, evidence.event)"
              >
                查看原文
              </button>
            </div>
          </section>

          <section v-if="budgetDetails(item.events).length" class="ai-detail-section">
            <h4>Budget</h4>
            <div v-for="budget in budgetDetails(item.events)" :key="budget.event.sequence" class="ai-budget-delta">
              <p>{{ budget.deltaText }}</p>
              <small>本次耗时 {{ formatDuration(budget.callDurationMs) }}</small>
              <dl class="ai-detail-fields compact">
                <template v-for="entry in budget.remaining" :key="entry.key">
                  <dt>{{ fieldLabel(entry.key) }}</dt><dd>剩余 {{ formatMetric(entry.key, entry.value) }}</dd>
                </template>
              </dl>
            </div>
          </section>

          <section v-if="recoveryDetails(item.events).length" class="ai-detail-section">
            <h4>错误恢复</h4>
            <div v-for="recovery in recoveryDetails(item.events)" :key="recovery.event.sequence" class="ai-recovery-row">
              <p><strong>{{ recovery.errorCode }}</strong><span>{{ recovery.retryable ? '可重试' : '不可重试' }}</span></p>
              <p v-if="recovery.action">{{ recovery.action }}</p>
            </div>
          </section>

          <section class="ai-detail-section ai-trace-section">
            <h4>关联信息</h4>
            <dl class="ai-detail-fields compact">
              <dt>事件序号</dt><dd>{{ item.events.map((event) => `#${event.sequence}`).join('、') }}</dd>
              <template v-if="item.toolCallId"><dt>Tool Call</dt><dd>{{ item.toolCallId }}</dd></template>
              <template v-if="item.modelCallId"><dt>Model Call</dt><dd>{{ item.modelCallId }}</dd></template>
              <template v-if="stepIds(item.events).length"><dt>Step</dt><dd>{{ stepIds(item.events).join('、') }}</dd></template>
            </dl>
          </section>
        </div>
      </details>
    </li>
  </ol>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { groupReadingEvents, type ReadingEventTimelineItem } from '../../features/ai-reading/domain/state';
import type {
  PublicPlanStep,
  ReadingAgentRun,
  ReadingCitation,
  ReadingEvent,
  ReadingEvidence,
  ReadingPlanStatus,
  ReadingTaskStatus,
} from '../../features/ai-reading/model/aiReading';

const props = defineProps<{
  events: ReadingEvent[];
  agents: ReadingAgentRun[];
  taskStatus: ReadingTaskStatus;
}>();

const emit = defineEmits<{
  citation: [evidence: ReadingEvidence];
}>();

const timelineItems = computed(() => groupReadingEvents(props.events, props.taskStatus));

function sequenceLabel(item: ReadingEventTimelineItem) {
  return item.startSequence === item.endSequence
    ? `#${item.startSequence}`
    : `#${item.startSequence}–#${item.endSequence}`;
}

function statusLabel(status: ReadingEventTimelineItem['status']) {
  return ({ running: '进行中', completed: '已完成', failed: '失败', interrupted: '已中断', recorded: '已记录' })[status];
}

function agentLabel(id?: string | null) {
  if (!id) return '系统';
  const agent = props.agents.find((item) => item.id === id);
  if (!agent) return id.slice(0, 8);
  if (agent.kind === 'root') return '主 Agent';
  const children = props.agents.filter((item) => item.kind === 'subagent');
  return `子 Agent ${Math.max(1, children.findIndex((item) => item.id === id) + 1)}`;
}

function agentSummary(events: ReadingEvent[]) {
  const labels = [...new Set(events.map((event) => agentLabel(event.agentRunId)))];
  if (labels.length <= 2) return labels.join(' · ');
  return `${labels[0]} 等 ${labels.length} 个 Agent`;
}

function isLegacy(events: ReadingEvent[]) {
  return events.every((event) => event.payload.schemaVersion === 1);
}

function v2Events(events: ReadingEvent[]) {
  return events.filter((event) => event.payload.schemaVersion === 2);
}

function detailOf(event: ReadingEvent): Record<string, any> {
  return event.payload.detail as Record<string, any>;
}

function toolPurpose(events: ReadingEvent[]) {
  return v2Events(events).map((event) => detailOf(event).purpose).find((value) => typeof value === 'string') ?? '';
}

function argumentEntries(events: ReadingEvent[]) {
  const args = v2Events(events).map((event) => detailOf(event).arguments).find(isRecord) ?? {};
  return Object.entries(args).map(([key, value]) => ({ key, value }));
}

function planDetails(events: ReadingEvent[]) {
  return v2Events(events).filter((event) => event.type === 'plan_updated').map((event) => {
    const detail = detailOf(event);
    return {
      event,
      before: publicPlanSteps(detail.before),
      after: publicPlanSteps(detail.after),
      nextAction: stringValue(detail.nextAction),
    };
  });
}

function agentLifecycle(events: ReadingEvent[]) {
  return v2Events(events).filter((event) => event.type.startsWith('agent_')).map((event) => {
    const detail = detailOf(event);
    return {
      event,
      goal: stringValue(detail.goal) || '阅读任务',
      status: publicStatusLabel(detail.status),
    };
  });
}

function toolOutcomes(events: ReadingEvent[]) {
  return v2Events(events).filter((event) => event.type === 'tool_observation').map((event) => {
    const detail = detailOf(event);
    const result = isRecord(detail.result) ? detail.result : {};
    const boundaries = isRecord(result.boundaries) ? result.boundaries : {};
    const pagination = isRecord(result.pagination) ? result.pagination : {};
    const coverage = isRecord(result.coverage) ? result.coverage : {};
    return {
      event,
      failed: detail.phase === 'failed',
      summary: event.payload.summary,
      excerpt: stringValue(result.excerpt),
      citation: readingCitation(result.citation),
      items: Array.isArray(result.items) ? result.items.filter(isRecord) : [],
      delegates: Array.isArray(result.delegates) ? result.delegates.filter(isRecord) : [],
      unavailable: Array.isArray(result.unavailable) ? result.unavailable.filter(isRecord) : [],
      boundaryEntries: [...Object.entries(boundaries), ...Object.entries(pagination), ...Object.entries(coverage)]
        .map(([key, value]) => ({ key, value })),
    };
  });
}

function evidenceDetails(events: ReadingEvent[]) {
  return v2Events(events).filter((event) => event.type === 'evidence_recorded').map((event) => {
    const detail = detailOf(event);
    return {
      event,
      quote: stringValue(detail.quote),
      chapterPath: stringValue(detail.chapterPath),
      citation: readingCitation(detail.citation),
    };
  });
}

function budgetDetails(events: ReadingEvent[]) {
  return v2Events(events).filter((event) => event.type === 'budget_updated').map((event) => {
    const detail = detailOf(event);
    const delta = isRecord(detail.delta) ? detail.delta : {};
    const remaining = isRecord(detail.remaining) ? detail.remaining : {};
    const deltaText = Object.entries(delta)
      .filter(([, value]) => Number(value) > 0)
      .map(([key, value]) => `${fieldLabel(key)} +${formatMetric(key, Number(value))}`)
      .join('，') || '预算快照已更新';
    return {
      event,
      deltaText,
      callDurationMs: numberValue(detail.callDurationMs),
      remaining: Object.entries(remaining).map(([key, value]) => ({ key, value: numberValue(value) })),
    };
  });
}

function recoveryDetails(events: ReadingEvent[]) {
  return v2Events(events).filter((event) => event.type === 'recovery_attempted').map((event) => {
    const detail = detailOf(event);
    return {
      event,
      errorCode: stringValue(detail.errorCode) || 'RECOVERY_REQUIRED',
      retryable: detail.retryable === true,
      action: stringValue(detail.recoveryAction),
    };
  });
}

function stepIds(events: ReadingEvent[]) {
  return [...new Set(events.map((event) => event.stepId).filter((value): value is string => Boolean(value)))];
}

function emitCitation(citation: ReadingCitation, quote: string, event: ReadingEvent, index = 0) {
  emit('citation', {
    id: event.evidenceId || `event-${event.sequence}-${index}`,
    quote: quote || citation.locator.textQuote?.exact || '',
    citation,
  });
}

function readingCitation(value: unknown): ReadingCitation | null {
  if (!isRecord(value) || !isRecord(value.locator) || !isRecord(value.locator.position)) return null;
  return value as unknown as ReadingCitation;
}

function resultItemTitle(item: Record<string, unknown>, index: number) {
  return stringValue(item.label || item.matchedText || item.selectedText || item.goal) || `结果 ${index + 1}`;
}

function resultItemBody(item: Record<string, unknown>) {
  return stringValue(item.snippet || item.note || item.path);
}

function resultItemMeta(item: Record<string, unknown>) {
  return stringValue(item.chapterPath || item.chapterLabel || item.locationQuality);
}

function resultItemQuote(item: Record<string, unknown>) {
  return stringValue(item.matchedText || item.selectedText || item.snippet);
}

function displayValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return new Intl.NumberFormat('zh-CN').format(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => isRecord(item)
      ? stringValue(item.goal || item.title || item.id) || displayObject(item)
      : displayValue(item)).join('；');
  }
  if (isRecord(value)) return displayObject(value);
  return '—';
}

function displayObject(value: Record<string, unknown>) {
  return Object.entries(value).map(([key, item]) => `${fieldLabel(key)}：${displayValue(item)}`).join(' · ');
}

function fieldLabel(key: string) {
  const labels: Record<string, string> = {
    cursorUsed: '使用分页游标', limit: '本页上限', nodeIds: '目录节点', direction: '阅读方向',
    maxChars: '最大字符数', position: '定位', chapter: '章节', query: '检索词', hasNote: '仅含笔记',
    types: '批注类型', stepCount: '计划步骤', nextAction: '下一步', subtasks: '子任务',
    modelTurns: '模型轮次', toolCalls: '工具调用', readCharacters: '阅读字符', durationMs: '时间',
    delegatedAgents: '子 Agent 总数', concurrentAgents: '并发子 Agent', previousAvailable: '可向前继续',
    nextAvailable: '可向后继续', reachedSectionStart: '到达章节开头', reachedSectionEnd: '到达章节末尾',
    reachedBookStart: '到达全书开头', reachedBookEnd: '到达全书末尾', hasMore: '还有下一页',
    nextCursorAvailable: '可继续分页', truncatedItems: '结果项已限长',
    nodeCount: '所选节点数', complete: '所选范围完整覆盖', returnedChars: '已返回字符',
    pendingChars: '待返回字符', unavailableChars: '不可读字符',
  };
  return labels[key] ?? key;
}

function planStatusLabel(status: ReadingPlanStatus) {
  return ({ pending: '待处理', in_progress: '进行中', completed: '完成', failed: '失败' })[status];
}

function publicStatusLabel(value: unknown) {
  const status = stringValue(value);
  return ({ running: '进行中', completed: '已完成', failed: '失败', partial: '部分完成', cancelled: '已停止', started: '已开始' } as Record<string, string>)[status] ?? status;
}

function formatMetric(key: string, value: number) {
  return key.toLowerCase().includes('ms') ? formatDuration(value) : new Intl.NumberFormat('zh-CN').format(value);
}

function formatDuration(value: number) {
  if (!Number.isFinite(value)) return '0 秒';
  if (value < 1_000) return `${Math.max(0, Math.round(value))} 毫秒`;
  const seconds = Math.round(value / 1_000);
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function publicPlanSteps(value: unknown): PublicPlanStep[] {
  return Array.isArray(value) ? value.filter((item): item is PublicPlanStep => (
    isRecord(item)
    && typeof item.id === 'string'
    && typeof item.title === 'string'
    && ['pending', 'in_progress', 'completed', 'failed'].includes(String(item.status))
  )) : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
</script>

<style scoped>
.ai-event-list { list-style: none; padding: 0; margin: 0; }
.ai-event-item { display: grid; grid-template-columns: 8px minmax(0, 1fr); gap: 10px; min-width: 0; }
.ai-event-rail { position: relative; min-height: 68px; }
.ai-event-rail::after { content: ''; position: absolute; top: 14px; bottom: -2px; left: 3px; width: 1px; background: var(--rd-divider); }
.ai-event-item:last-child .ai-event-rail::after { display: none; }
.ai-event-rail span { position: absolute; top: 9px; left: 0; width: 7px; height: 7px; border-radius: 50%; background: var(--rd-muted); }
.ai-event-rail span.status-running { background: #2563eb; }.ai-event-rail span.status-completed { background: #16a34a; }
.ai-event-rail span.status-failed, .ai-event-rail span.status-interrupted { background: #dc2626; }
.ai-event-disclosure { min-width: 0; padding-bottom: 13px; }
.ai-event-disclosure > summary { min-width: 0; cursor: pointer; color: var(--rd-fg); list-style-position: outside; }
.ai-event-disclosure > summary::marker { color: var(--rd-muted); font-size: 9px; }
.ai-event-disclosure > summary:focus-visible { outline: 2px solid var(--rd-accent); outline-offset: 3px; border-radius: 2px; }
.ai-event-summary-content { min-width: 0; padding-left: 2px; }
.ai-event-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; color: var(--rd-muted); font-size: 9px; }
.ai-agent-tag { color: #1d4ed8; font-weight: 800; }.ai-event-state { margin-left: auto; font-weight: 750; }
.ai-event-state.status-completed { color: #16a34a; }.ai-event-state.status-running { color: #2563eb; }
.ai-event-state.status-failed, .ai-event-state.status-interrupted { color: #dc2626; }
.ai-event-title { margin-top: 4px; color: var(--rd-fg); font-size: 11px; font-weight: 700; overflow-wrap: anywhere; }
.ai-event-description { margin: 3px 0 0; color: var(--rd-muted-strong); font-size: 10px; line-height: 1.5; overflow-wrap: anywhere; }
.ai-event-detail { min-width: 0; margin: 10px 0 2px; padding-left: 3px; border-left: 2px solid var(--rd-divider); }
.ai-detail-section { min-width: 0; padding: 9px 0 9px 11px; border-top: 1px solid var(--rd-divider); }
.ai-detail-section:first-child { border-top: 0; }.ai-detail-section h4 { margin: 0 0 7px; color: var(--rd-muted); font-size: 9px; font-weight: 800; }
.ai-detail-section p { margin: 0; color: var(--rd-fg); font-size: 10px; line-height: 1.55; overflow-wrap: anywhere; white-space: pre-wrap; }
.ai-event-legacy { margin: 0; padding: 8px 0 8px 11px; color: var(--rd-muted); font-size: 10px; }
.ai-detail-fields { display: grid; grid-template-columns: minmax(82px, .42fr) minmax(0, 1fr); gap: 5px 10px; margin: 0; font-size: 9px; }
.ai-detail-fields.compact { margin-top: 8px; }.ai-detail-fields dt { color: var(--rd-muted); }.ai-detail-fields dd { min-width: 0; margin: 0; color: var(--rd-fg); overflow-wrap: anywhere; white-space: pre-wrap; }
.ai-plan-snapshot > span { display: block; margin: 7px 0 4px; color: var(--rd-muted); font-size: 9px; font-weight: 750; }
.ai-plan-snapshot ol { margin: 0; padding-left: 18px; }.ai-plan-snapshot li { padding: 2px 0; color: var(--rd-fg); font-size: 10px; }
.ai-plan-snapshot li small { margin-left: 7px; color: var(--rd-muted); }.ai-plan-snapshot.current { border-left: 2px solid #2563eb; padding-left: 8px; }
.ai-next-action { margin-top: 8px !important; }.ai-next-action strong { margin-right: 7px; color: var(--rd-muted); font-size: 9px; }
.ai-agent-lifecycle, .ai-scan-results, .ai-delegate-results { list-style: none; padding: 0; margin: 0; display: grid; gap: 7px; }
.ai-agent-lifecycle li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 7px; align-items: baseline; font-size: 9px; }
.ai-agent-lifecycle li > span:first-child { color: #1d4ed8; font-weight: 750; }.ai-agent-goal { color: var(--rd-fg); overflow-wrap: anywhere; }.ai-agent-lifecycle small { color: var(--rd-muted); }
.ai-reading-excerpt, .ai-evidence-row blockquote { margin: 7px 0; padding-left: 9px; border-left: 2px solid var(--rd-accent); color: var(--rd-fg); font-size: 10px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.ai-citation-action { margin-top: 5px; padding: 4px 0; color: var(--rd-accent); font-size: 9px; font-weight: 750; }
.ai-citation-action:focus-visible { outline: 2px solid var(--rd-accent); outline-offset: 2px; }
.ai-scan-results li { min-width: 0; padding-top: 7px; border-top: 1px solid var(--rd-divider); }.ai-scan-results strong { display: block; color: var(--rd-fg); font-size: 10px; overflow-wrap: anywhere; }
.ai-scan-results p { margin-top: 3px; color: var(--rd-muted-strong); }.ai-scan-results small { display: block; margin-top: 3px; color: var(--rd-muted); overflow-wrap: anywhere; }
.ai-delegate-results li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 8px; font-size: 9px; }.ai-delegate-results strong { color: var(--rd-fg); overflow-wrap: anywhere; }.ai-delegate-results span { color: #1d4ed8; }.ai-delegate-results small { grid-column: 1 / -1; color: var(--rd-muted); }
.ai-evidence-row + .ai-evidence-row, .ai-budget-delta + .ai-budget-delta, .ai-recovery-row + .ai-recovery-row { margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--rd-divider); }
.ai-evidence-row > span { display: block; color: var(--rd-muted); font-size: 9px; }.ai-budget-delta > small { display: block; margin-top: 3px; color: var(--rd-muted); font-size: 9px; }
.ai-recovery-row p:first-child { display: flex; justify-content: space-between; gap: 10px; }.ai-recovery-row strong { color: #dc2626; }.ai-recovery-row span { color: var(--rd-muted); }
.ai-trace-section { padding-bottom: 2px; }.ai-trace-section dd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 8px; }
@media (max-width: 640px) {
  .ai-detail-fields { grid-template-columns: minmax(76px, .38fr) minmax(0, 1fr); }
  .ai-agent-lifecycle li { grid-template-columns: auto minmax(0, 1fr); }.ai-agent-lifecycle small { grid-column: 2; }
}
</style>
