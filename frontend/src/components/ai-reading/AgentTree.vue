<template>
  <ol v-if="taskEvents.length" class="agent-task-events" aria-label="任务公开事件">
    <li v-for="event in taskEvents" :key="event.sequence" :data-task-event="event.sequence">
      <span>#{{ event.sequence }}</span>
      <div><strong>{{ event.payload.title }}</strong><p v-if="event.payload.summary">{{ event.payload.summary }}</p></div>
    </li>
  </ol>
  <ol v-if="rows.length" class="agent-tree" role="tree" aria-label="Agent 探索树">
    <li
      v-for="row in rows"
      :key="row.agent.id"
      class="agent-tree-row"
      :style="{ '--agent-depth': row.depth }"
      role="treeitem"
      :aria-level="row.depth + 1"
      :aria-expanded="row.hasChildren ? isExpanded(row.agent.id) : undefined"
      :data-agent-id="row.agent.id"
    >
      <div class="agent-node-head">
        <button
          v-if="row.hasChildren"
          class="agent-node-toggle"
          type="button"
          :title="isExpanded(row.agent.id) ? '折叠子 Agent' : '展开子 Agent'"
          :aria-label="isExpanded(row.agent.id) ? `折叠 ${row.agent.goal}` : `展开 ${row.agent.goal}`"
          :aria-expanded="isExpanded(row.agent.id)"
          :data-agent-toggle="row.agent.id"
          @click="toggle(row.agent.id)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
            <path :d="isExpanded(row.agent.id) ? 'm6 9 6 6 6-6' : 'm9 18 6-6-6-6'" />
          </svg>
        </button>
        <span v-else class="agent-node-spacer" aria-hidden="true" />
        <span class="agent-kind" :class="row.agent.kind">{{ row.agent.kind === 'root' ? '主' : row.depth }}</span>
        <div class="agent-node-copy">
          <strong>{{ row.agent.goal }}</strong>
          <span v-if="row.agent.deliverable">{{ row.agent.deliverable }}</span>
        </div>
        <span class="agent-status" :class="statusTone(row.agent.status)">{{ statusLabel(row.agent.status) }}</span>
      </div>

      <dl v-if="usageEntries(row.agent).length" class="agent-usage">
        <template v-for="entry in usageEntries(row.agent)" :key="entry.label">
          <dt>{{ entry.label }}</dt><dd>{{ entry.value }}</dd>
        </template>
      </dl>

      <ol v-if="isExpanded(row.agent.id) && eventsFor(row.agent.id).length" class="agent-events" aria-label="公开探索事件">
        <li v-for="event in eventsFor(row.agent.id)" :key="event.sequence">
          <span>#{{ event.sequence }}</span>
          <div><strong>{{ event.payload.title }}</strong><p v-if="event.payload.summary">{{ event.payload.summary }}</p><button v-if="evidenceFor(event)" type="button" class="agent-event-citation" @click="emit('citation', evidenceFor(event)!)">查看原文</button></div>
        </li>
      </ol>
    </li>
  </ol>
  <p v-else class="agent-empty">暂无 Agent 节点</p>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import type {
  ReadingAgentRun,
  ReadingAgentRunStatus,
  ReadingEvidence,
  ReadingEvent,
} from '../../features/ai-reading/model/aiReading';

const props = defineProps<{
  agents: ReadingAgentRun[];
  events: ReadingEvent[];
}>();

const emit = defineEmits<{ citation: [evidence: ReadingEvidence] }>();
const expanded = reactive(new Set<string>());

const taskEvents = computed(() => props.events.filter((event) => (
  event.agentRunId === null
  && event.payload.schemaVersion === 2
  && ['task', 'plan', 'recovery'].includes(event.payload.kind)
)));

watch(() => props.agents, (agents) => {
  for (const agent of agents) {
    if (agent.parentRunId === null) expanded.add(agent.id);
  }
}, { immediate: true });

const childrenByParent = computed(() => {
  const value = new Map<string | null, ReadingAgentRun[]>();
  for (const agent of props.agents) {
    const siblings = value.get(agent.parentRunId) ?? [];
    siblings.push(agent);
    value.set(agent.parentRunId, siblings);
  }
  return value;
});

const rows = computed(() => {
  const result: Array<{ agent: ReadingAgentRun; depth: number; hasChildren: boolean }> = [];
  const visit = (agent: ReadingAgentRun, depth: number) => {
    const children = childrenByParent.value.get(agent.id) ?? [];
    result.push({ agent, depth, hasChildren: children.length > 0 });
    if (!expanded.has(agent.id)) return;
    for (const child of children) visit(child, depth + 1);
  };
  for (const root of childrenByParent.value.get(null) ?? []) visit(root, 0);
  return result;
});

function toggle(id: string) {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
}

function isExpanded(id: string) {
  return expanded.has(id);
}

function eventsFor(agentRunId: string) {
  return props.events.filter((event) => (
    event.agentRunId === agentRunId
    && event.payload.schemaVersion === 2
    && ['agent', 'tool', 'evidence', 'budget', 'recovery', 'plan'].includes(event.payload.kind)
  ));
}

function evidenceFor(event: ReadingEvent): ReadingEvidence | null {
  if (event.payload.schemaVersion !== 2 || event.payload.kind !== 'evidence' || !event.evidenceId) return null;
  const detail = event.payload.detail as { quote?: unknown; citation?: unknown };
  if (typeof detail.quote !== 'string' || !detail.citation || typeof detail.citation !== 'object') return null;
  return { id: event.evidenceId, quote: detail.quote, citation: detail.citation as ReadingEvidence['citation'] };
}

function usageEntries(agent: ReadingAgentRun) {
  const usage = agent.usage;
  if (!usage) return [];
  const entries = [
    metric('模型', usage.modelTurns),
    metric('工具', usage.toolCalls),
    metric('阅读', usage.readCharacters, true),
    metric('Token', usage.totalTokens),
  ];
  return entries.filter((entry): entry is { label: string; value: string } => Boolean(entry));
}

function metric(label: string, value: number | undefined, characters = false) {
  if (typeof value !== 'number') return null;
  return { label, value: `${new Intl.NumberFormat('zh-CN').format(value)}${characters ? ' 字' : ''}` };
}

function statusLabel(status: ReadingAgentRunStatus) {
  return ({
    queued: '排队中', running: '探索中', waiting_children: '等待子节点', completed: '已完成',
    partial: '部分完成', needs_input: '待澄清', failed: '失败', cancelled: '已停止',
  } as Record<ReadingAgentRunStatus, string>)[status];
}

function statusTone(status: ReadingAgentRunStatus) {
  if (status === 'completed') return 'success';
  if (status === 'queued' || status === 'running' || status === 'waiting_children') return 'active';
  if (status === 'partial' || status === 'needs_input') return 'warning';
  return 'danger';
}
</script>

<style scoped>
.agent-tree, .agent-events, .agent-task-events { list-style: none; margin: 0; padding: 0; }
.agent-task-events { display: grid; gap: 6px; padding: 0 0 10px; border-bottom: 1px solid var(--rd-divider); }
.agent-task-events li { display: grid; grid-template-columns: 25px minmax(0, 1fr); gap: 6px; color: var(--rd-muted); font-size: 8px; }.agent-task-events strong { color: var(--rd-fg); font-size: 9px; }.agent-task-events p { margin: 2px 0 0; line-height: 1.45; overflow-wrap: anywhere; }
.agent-tree-row { min-width: 0; margin-left: calc(var(--agent-depth) * 14px); padding: 9px 0; border-top: 1px solid var(--rd-divider); }
.agent-tree-row:first-child { border-top: 0; }
.agent-node-head { display: flex; min-width: 0; align-items: center; gap: 7px; }
.agent-node-toggle, .agent-node-spacer { width: 24px; height: 24px; flex: 0 0 24px; }
.agent-node-toggle { display: grid; place-items: center; border-radius: 4px; color: var(--rd-muted); }
.agent-node-toggle:hover { color: var(--rd-fg); background: var(--rd-hover-bg); }
.agent-node-toggle:focus-visible { outline: 2px solid var(--rd-accent); outline-offset: 1px; }
.agent-kind { width: 24px; height: 24px; flex: 0 0 24px; display: grid; place-items: center; border-radius: 5px; background: #dbeafe; color: #1d4ed8; font-size: 9px; font-weight: 800; }
.agent-kind.root { background: #111827; color: #fff; }
.agent-node-copy { min-width: 0; flex: 1; }
.agent-node-copy strong, .agent-node-copy span { display: block; overflow-wrap: anywhere; }
.agent-node-copy strong { color: var(--rd-fg); font-size: 11px; line-height: 1.45; }
.agent-node-copy span { margin-top: 2px; color: var(--rd-muted); font-size: 9px; line-height: 1.45; }
.agent-status { flex: 0 0 auto; font-size: 9px; font-weight: 750; }
.agent-status.success { color: #16a34a; }.agent-status.active { color: #2563eb; }
.agent-status.warning { color: #d97706; }.agent-status.danger { color: #dc2626; }
.agent-usage { display: flex; flex-wrap: wrap; gap: 3px 10px; margin: 7px 0 0 55px; font-size: 8px; }
.agent-usage dt { color: var(--rd-muted); }.agent-usage dd { margin: 0; color: var(--rd-muted-strong); }
.agent-events { margin: 8px 0 0 55px; display: grid; gap: 6px; }
.agent-events li { display: grid; grid-template-columns: 25px minmax(0, 1fr); gap: 6px; color: var(--rd-muted); font-size: 8px; }
.agent-events strong { color: var(--rd-fg); font-size: 9px; }.agent-events p { margin: 2px 0 0; line-height: 1.45; overflow-wrap: anywhere; }
.agent-event-citation { margin-top: 4px; color: var(--rd-accent); font-size: 8px; font-weight: 750; }
.agent-empty { margin: 0; padding: 16px 0; color: var(--rd-muted); text-align: center; font-size: 10px; }
</style>
