// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { it, expect } from 'vitest';
import QaProcessDisclosure from '../components/selection-qa/QaProcessDisclosure.vue';
it('shows full context and results, hides empty phase records and explains answer preparation', () => {
  const text = '完整正文'.repeat(150) + '最后一个字';
  const steps = [
    { sequence: 1, at: 1, phase: 'answer', detail: {} },
    { sequence: 2, at: 2, phase: 'context', detail: { operation: 'selection_context', state: 'completed', results: [{ href: 'chapter', start: 0, end: text.length, text }] } },
    { sequence: 3, at: 3, phase: 'answer', detail: { operation: 'stream', state: 'started', modelId: 'test-model', evidenceCount: 1, evidenceChars: text.length } },
  ];
  const w = mount(QaProcessDisclosure, { props: { steps, active: true } });
  expect(w.findAll('li')).toHaveLength(2);
  expect(w.get('blockquote').text()).toBe(text);
  expect(w.text()).toContain('test-model');
  expect(w.text()).toContain('正在等待模型返回正文首段');
  expect(w.text()).not.toContain('阶段记录');
  expect(w.text()).not.toContain('（摘录）');
});

it('restores query intent, full selected/rejected passages and external limitations', () => {
  const steps = [
    { sequence: 1, at: 1, phase: 'retrieving', detail: { operation: 'search_book', state: 'started', informationNeed: '解释SSD I/O', queries: ['SSD 随机I/O'] } },
    { sequence: 2, at: 2, phase: 'planning', detail: { operation: 'finish_research', state: 'completed', informationNeeds: ['解释SSD I/O'], selectedEvidenceIds: ['yes'], rejectedEvidenceIds: ['no'], externalEvidenceNeeded: ['ACE是否损坏SSD'], insufficientEvidence: [], conclusion: '结束查阅', results: [{ href: 'chapter', start: 0, end: 2, text: '相关', selected: true }, { href: 'chapter', start: 2, end: 4, text: '无关', selected: false }] } },
  ];
  const w = mount(QaProcessDisclosure, { props: { steps, active: false } });
  expect(w.text()).toContain('本次查阅目标：解释SSD I/O');
  expect(w.text()).toContain('需要外部证据，当前无法核实：ACE是否损坏SSD');
  expect(w.text()).toContain('选用 1 个片段；排除 1 个片段');
  expect(w.findAll('blockquote').map(n => n.text())).toEqual(['相关', '无关']);
});

it('shows all rejected bounds and does not call search errors exhausted budget', () => {
  const validations = [
    { field: 'queries', constraint: 'itemCount', actual: 5, minimum: 1, maximum: 4 },
    { field: 'limit', constraint: 'range', actual: 8, minimum: 1, maximum: 5 },
  ];
  const w = mount(QaProcessDisclosure, { props: { active: false, steps: [
    { sequence: 1, at: 1, phase: 'retrieving', detail: { operation: 'search_book', state: 'failed', validation: validations[0], validations, researchLimited: true } },
  ] } });
  expect(w.text()).toContain('实际 5，允许 1～4');
  expect(w.text()).toContain('实际 8，允许 1～5');
  expect(w.text()).not.toContain('预算已用完');
  expect(w.findAll('p').filter(p => p.text().startsWith('参数约束'))).toHaveLength(2);
});

it('shows expanded full source text and the selected candidate provenance', () => {
  const text = '完整因果上下文'.repeat(200);
  const w = mount(QaProcessDisclosure, { props: { active: false, steps: [
    { sequence: 1, at: 1, phase: 'retrieving', detail: { operation: 'evidence_expansion', state: 'completed', results: [{ href: 'chapter', start: 100, end: 100 + text.length, text, sourceEvidenceId: 'candidate-8', evidenceId: 'expanded-8' }] } },
  ] } });
  expect(w.text()).toContain('扩展证据上下文');
  expect(w.text()).toContain('来源片段：candidate-8；引用片段：expanded-8');
  expect(w.get('blockquote').text()).toBe(text);
});

it('distinguishes past search reuse from a new search result', () => {
  const w = mount(QaProcessDisclosure, { props: { active: false, steps: [{ sequence: 1, at: 1, phase: 'planning', detail: { operation: 'search_reuse', state: 'completed', resultCount: 5 } }] } });
  expect(w.text()).toContain('复用既有搜索结果（未重新搜索）');
  expect(w.text()).toContain('上次返回 5 个候选');
  expect(w.text()).not.toContain('找到 5 个片段');
});
