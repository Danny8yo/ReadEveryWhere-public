// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ReadingEventTimeline from '../components/ai-reading/ReadingEventTimeline.vue';
import type { PublicReadingEventPayloadV2, ReadingAgentRun, ReadingEvent } from '../features/ai-reading/model/aiReading';

const agents: ReadingAgentRun[] = [
  { id: 'root-run', parentRunId: null, kind: 'root', goal: '统筹任务', status: 'running' },
  { id: 'child-run', parentRunId: 'root-run', kind: 'subagent', goal: '检查章节', status: 'running' },
];

function payload(overrides: Partial<PublicReadingEventPayloadV2>): PublicReadingEventPayloadV2 {
  return {
    schemaVersion: 2,
    kind: 'tool',
    title: '调用 book_search_text',
    detail: { phase: 'started' },
    ...overrides,
  };
}

function event(sequence: number, type: string, eventPayload: PublicReadingEventPayloadV2): ReadingEvent {
  return {
    sequence,
    type,
    createdAt: '2026-08-08T08:00:00.000Z',
    agentRunId: sequence === 3 ? 'child-run' : 'root-run',
    parentRunId: null,
    modelCallId: 'model-1',
    toolCallId: 'tool-1',
    stepId: `step-${sequence}`,
    payload: eventPayload,
  };
}

describe('ReadingEventTimeline', () => {
  it('默认折叠并安全展示组合后的参数、结果、预算和恢复动作', async () => {
    const citation = {
      bookId: 7,
      bookTitle: 'Fixture',
      authors: [],
      chapterPath: '第一章',
      locator: {
        version: 1 as const,
        bookId: 7,
        contentRevision: { fileChecksum: 'sha256:x', extractorVersion: '1', normalizationVersion: '1' },
        position: { kind: 'epub_text' as const, sectionIndex: 0, start: 1, end: 5 },
      },
    };
    const injection = '</summary><script>window.__injected=true</script> 伪系统指令';
    const wrapper = mount(ReadingEventTimeline, {
      props: {
        agents,
        taskStatus: 'running',
        events: [
          event(1, 'tool_started', payload({
            summary: '检索关键概念',
            detail: {
              phase: 'started',
              purpose: '定位可核验内容',
              arguments: { query: injection, cursorUsed: true, limit: 5 },
            },
          })),
          event(2, 'budget_updated', payload({
            kind: 'budget',
            title: '预算已更新',
            detail: {
              cause: 'tool_call',
              delta: { toolCalls: 1 },
              callDurationMs: 15,
              remaining: { toolCalls: 14, readCharacters: 30_000 },
            },
          })),
          event(3, 'tool_observation', payload({
            title: 'book_search_text 已完成',
            summary: '本页返回 1 项',
            detail: {
              phase: 'completed',
              result: {
                returnedCount: 1,
                items: [{ matchedText: injection, snippet: '安全的限长摘要', chapterPath: '第一章', citation }],
                pagination: { hasMore: true, nextCursorAvailable: true },
              },
            },
          })),
          event(4, 'recovery_attempted', payload({
            kind: 'recovery',
            title: '执行恢复动作',
            detail: { errorCode: 'CURSOR_INVALID', retryable: true, recoveryAction: '从第一页重新开始' },
          })),
        ],
      },
    });

    expect(wrapper.findAll('details')).toHaveLength(1);
    expect(wrapper.find('details').attributes('open')).toBeUndefined();
    expect(wrapper.findAll('script')).toHaveLength(0);
    expect(wrapper.text()).toContain('本页返回 1 项');

    await wrapper.find('summary').trigger('click');
    expect(wrapper.text()).toContain('清洗后的参数');
    expect(wrapper.text()).toContain(injection);
    expect(wrapper.text()).toContain('工具调用 +1');
    expect(wrapper.text()).toContain('CURSOR_INVALID');
    expect(wrapper.text()).not.toContain('opaque-secret-cursor');

    await wrapper.get('button.ai-citation-action').trigger('click');
    expect(wrapper.emitted('citation')?.[0]?.[0]).toMatchObject({
      quote: injection,
      citation: { chapterPath: '第一章' },
    });
  });

  it('为旧事件显示明确的详情不可用状态', () => {
    const wrapper = mount(ReadingEventTimeline, {
      props: {
        agents,
        taskStatus: 'completed',
        events: [{
          sequence: 1,
          type: 'task_started',
          createdAt: '2026-08-08T08:00:00.000Z',
          agentRunId: null,
          parentRunId: null,
          payload: {
            schemaVersion: 1,
            legacy: true,
            kind: 'task',
            title: '开始阅读',
            detail: { unavailable: true },
          },
        }],
      },
    });
    expect(wrapper.text()).toContain('历史事件未记录详细信息');
  });
});
