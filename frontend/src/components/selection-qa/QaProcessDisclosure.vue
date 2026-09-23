<template>
  <details class="qa-process" :open="active" data-testid="qa-process">
    <summary>执行过程 · {{ visibleSteps.length }} 条记录</summary>
    <p v-if="!visibleSteps.length">这条历史记录未保存详细过程。</p>
    <ol>
      <li v-for="step in visibleSteps" :key="step.sequence">
        <div><strong>{{ label(step.detail.operation, step.phase) }}</strong> · {{ stateLabel(step.detail.state, step.phase) }}<span v-if="typeof step.detail.elapsedMs === 'number'"> · {{ seconds(step.detail.elapsedMs) }} 秒</span></div>
        <p v-if="step.phase === 'index_wait'">本书索引尚未就绪，完成构建后继续检索。</p>
        <p v-if="sourceTitle(step.detail.sourceBook)">本轮书内来源：《{{ sourceTitle(step.detail.sourceBook) }}》</p>
        <p v-if="typeof step.detail.informationNeed === 'string'">本次查阅目标：{{ step.detail.informationNeed }}</p>
        <template v-if="step.detail.operation === 'finish_research' && step.detail.state === 'completed'">
          <p>信息需求：{{ informationNeeds(step.detail.informationNeeds).join('；') }}</p>
          <p>结束查阅：{{ step.detail.conclusion }}</p>
          <p>选用 {{ textList(step.detail.selectedEvidenceIds).length }} 个片段；排除 {{ textList(step.detail.rejectedEvidenceIds).length }} 个片段。</p>
          <p v-if="optionalTextList(step.detail.budgetOmittedEvidenceIds).length">其中 {{ optionalTextList(step.detail.budgetOmittedEvidenceIds).length }} 个低优先级候选因本轮证据预算未选用。</p>
          <p v-if="textList(step.detail.externalEvidenceNeeded).length">需要外部证据，当前无法核实：{{ textList(step.detail.externalEvidenceNeeded).join('；') }}</p>
          <p v-if="textList(step.detail.insufficientEvidence).length">书内证据不足：{{ textList(step.detail.insufficientEvidence).join('；') }}</p>
        </template>
        <p v-if="Array.isArray(step.detail.queries)">检索词：{{ step.detail.queries.join('；') }}</p>
        <p v-if="typeof step.detail.href === 'string'">{{ step.detail.href }} · 字符 {{ step.detail.start }}–{{ step.detail.end }}</p>
        <p v-if="step.detail.operation === 'search_reuse'">上次返回 {{ step.detail.resultCount }} 个候选、选用 {{ selectedCount(step.detail.selectedCandidateCount) }} 个；本次未重新读取候选正文。</p>
        <p v-else-if="typeof step.detail.resultCount === 'number'">找到 {{ step.detail.resultCount }} 个片段</p>
        <details v-for="(result, index) in results(step.detail.results)" :key="index">
          <summary><span v-if="typeof result.selected === 'boolean'">{{ result.selected ? '选用 · ' : '排除 · ' }}</span>{{ result.href }} · {{ result.start }}–{{ result.end }}</summary>
          <p v-if="step.detail.operation === 'evidence_expansion'">来源片段：{{ result.sourceEvidenceId }}；引用片段：{{ result.evidenceId }}</p>
          <blockquote>{{ result.text ?? result.excerpt }}{{ result.truncated ? '…（此历史过程只保存了摘录，未找到匹配的完整证据）' : '' }}</blockquote>
        </details>
        <p v-if="step.detail.operation === 'stream' && step.detail.state === 'started'">查阅已结束，向 {{ step.detail.modelId }} 请求生成回答；提供 {{ step.detail.evidenceCount }} 个证据片段，共 {{ step.detail.evidenceChars }} 字符。正在等待模型返回正文首段。</p>
        <p v-if="step.detail.researchLimited">本轮查阅受到限制，模型将基于已获得的证据回答。</p>
        <template v-if="Array.isArray(step.detail.validations)"><p v-for="(issue, i) in step.detail.validations" :key="i">参数约束：{{ validationText(issue) }}</p></template>
        <p v-else-if="step.detail.validation">参数约束：{{ validationText(step.detail.validation) }}</p>
        <p v-if="step.detail.errorCode">工具失败：{{ step.detail.errorCode }}</p>
        <p v-if="typeof step.detail.firstDeltaMs === 'number'">正文首段等待 {{ seconds(step.detail.firstDeltaMs) }} 秒；接收 {{ step.detail.deltaCount }} 个增量，输出历时 {{ seconds(Number(step.detail.deliveryMs)) }} 秒。</p>
      </li>
    </ol>
  </details>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { Turn } from '../../features/selection-qa/model/selectionQa';
const props = defineProps<{ steps: NonNullable<Turn['process']>; active: boolean }>();
const visibleSteps = computed(() => props.steps.filter(step => (typeof step.detail.operation === 'string' && step.detail.operation !== 'context_usage') || step.phase === 'index_wait'));
function seconds(ms: number) { return (ms / 1000).toFixed(2); }
function label(operation: unknown, phase: string) {
  const labels: Record<string, string> = { source_context: '确认当前书籍', search_reuse: '复用既有搜索结果（未重新搜索）', evidence_expansion: '扩展证据上下文', finish_research: '查阅结论与证据筛选', selection_context: '读取选文及附近正文', history_context: '重新读取历史引用正文', search_book: '搜索本书（search_book）', read_book: '读取原文（read_book）', model: '模型决定是否继续查阅', stream: '生成回答', context: '读取选文上下文', planning: '模型准备', retrieving: '检索', reading: '读取', index_wait: '等待书籍索引', answer: '准备回答' };
  return labels[String(operation ?? phase)] ?? '任务状态';
}
function stateLabel(state: unknown, phase: string) { if (phase === 'index_wait') return '等待构建完成'; return ({ started: '开始', completed: '完成', failed: '失败', first_delta: '收到正文首段' } as Record<string, string>)[String(state)] ?? '阶段记录'; }
function validationText(value: unknown): string {
  if (!value || typeof value !== 'object' || !('field' in value) || typeof value.field !== 'string' || !('constraint' in value) || typeof value.constraint !== 'string') throw new Error('非法参数校验详情');
  const actual = 'actual' in value && typeof value.actual === 'number' ? `，实际 ${value.actual}` : '';
  const minimum = 'minimum' in value && typeof value.minimum === 'number' ? value.minimum : undefined;
  const maximum = 'maximum' in value && typeof value.maximum === 'number' ? value.maximum : undefined;
  const bounds = minimum !== undefined && maximum !== undefined ? `，允许 ${minimum}～${maximum}` : '';
  return `${value.field} — ${value.constraint}${actual}${bounds}`;
}
function textList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('非法查阅决策');
  return value;
}
function optionalTextList(value: unknown): string[] {
  return value === undefined ? [] : textList(value);
}
function sourceTitle(value: unknown): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || !('title' in value) || typeof value.title !== 'string') throw new Error('非法书籍来源');
  return value.title;
}
function selectedCount(value: unknown): string {
  if (value === null || value === undefined) return '未知';
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error('非法证据选用数量');
  return String(value);
}
function informationNeeds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('非法查阅决策');
  return value.map(item => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object' || !('text' in item) || typeof item.text !== 'string' || !('targetSource' in item) || typeof item.targetSource !== 'string') throw new Error('非法查阅决策');
    const labels: Record<string, string> = { current_book: '当前书', model_knowledge: '模型通用知识', other_book_unverified: '其他书籍尚未核实' };
    const label = labels[item.targetSource]; if (!label) throw new Error('非法查阅来源');
    const source = 'sourceName' in item && typeof item.sourceName === 'string' && item.sourceName ? `《${item.sourceName}》` : '';
    return `${item.text}（${label}${source}）`;
  });
}
function results(value: unknown): Array<{ href: string; start: number; end: number; text?: string; excerpt?: string; truncated?: boolean; selected?: boolean; evidenceId?: string; sourceEvidenceId?: string }> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('非法工具结果');
  return value;
}
</script>
<style scoped>
.qa-process { margin: 8px 0 14px; padding: 12px; border: 1px solid var(--rd-border, #ddd); border-radius: 8px; font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
summary { cursor: pointer; }
ol { margin: 10px 0 0; padding-left: 20px; max-height: 360px; overflow: auto; }
li { padding: 6px 0; } p { margin: 4px 0; } blockquote { margin: 6px 0; padding-left: 10px; border-left: 2px solid var(--rd-border, #ccc); white-space: pre-wrap; }
</style>
