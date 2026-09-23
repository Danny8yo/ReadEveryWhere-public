import { describe, expect, it } from 'vitest';
import {
  boundedBudgetUsage,
  buildCitationAttempts,
  groupReadingEvents,
  isReadingTaskActive,
  latestPublicPlan,
  mergeReadingEvents,
  streamedAnswer,
} from '../features/ai-reading/domain/state';
import type { PublicReadingEventPayloadV2, ReadingEvent, ReadingTaskDetail } from '../features/ai-reading/model/aiReading';

const payload = (overrides: Partial<PublicReadingEventPayloadV2> = {}): PublicReadingEventPayloadV2 => ({
  schemaVersion: 2,
  kind: 'tool',
  title: '调用 book_read',
  toolName: 'book_read',
  detail: { phase: 'completed', result: { characterCount: 12 } },
  ...overrides,
});

const event = (sequence: number, type = 'tool_observation'): ReadingEvent => ({
  sequence,
  type,
  createdAt: `2026-08-06T00:00:0${sequence}.000Z`,
  agentRunId: 'agent-1',
  parentRunId: 'root-1',
  payload: payload(),
});

describe('AI 阅读增量状态', () => {
  it('按最新 answerId 和 offset 重放流式答案，并以 completed 文本收敛', () => {
    const events = [
      answerEvent(1, 'answer_started', { phase: 'started', answerId: 'answer-1', mode: 'model' }),
      answerEvent(2, 'answer_delta', { phase: 'streaming', answerId: 'answer-1', offset: 0, delta: '旧回答' }),
      answerEvent(3, 'answer_started', { phase: 'started', answerId: 'answer-2', mode: 'model' }),
      answerEvent(4, 'answer_delta', { phase: 'streaming', answerId: 'answer-2', offset: 0, delta: '新的' }),
      answerEvent(5, 'answer_delta', { phase: 'streaming', answerId: 'answer-2', offset: 2, delta: '回答' }),
    ];

    expect(streamedAnswer(events)).toEqual({
      answerId: 'answer-2', text: '新的回答', phase: 'streaming', mode: 'model', evidenceIds: [],
    });

    events.push(answerEvent(6, 'answer_completed', {
      phase: 'completed', answerId: 'answer-2', mode: 'model', text: '最终回答。',
      characterCount: 5, evidenceIds: ['evidence-1'],
    }));
    expect(streamedAnswer(events)).toEqual({
      answerId: 'answer-2', text: '最终回答。', phase: 'completed', mode: 'model', evidenceIds: ['evidence-1'],
    });
  });

  it('模型流中断后只呈现新 answerId 的完整 fallback', () => {
    const events = [
      answerEvent(1, 'answer_started', { phase: 'started', answerId: 'model-answer', mode: 'model' }),
      answerEvent(2, 'answer_delta', {
        phase: 'streaming', answerId: 'model-answer', offset: 0, delta: '半截模型回答。',
      }),
      answerEvent(3, 'answer_started', { phase: 'started', answerId: 'fallback-answer', mode: 'fallback' }),
      answerEvent(4, 'answer_delta', {
        phase: 'streaming', answerId: 'fallback-answer', offset: 0, delta: '完整兜底回答。',
      }),
      answerEvent(5, 'answer_completed', {
        phase: 'completed', answerId: 'fallback-answer', mode: 'fallback', text: '完整兜底回答。',
        characterCount: 7, evidenceIds: ['evidence-1'],
      }),
    ];

    expect(streamedAnswer(events)).toEqual({
      answerId: 'fallback-answer', text: '完整兜底回答。', phase: 'completed',
      mode: 'fallback', evidenceIds: ['evidence-1'],
    });
  });

  it('按 sequence 合并、排序并去重重放事件', () => {
    expect(mergeReadingEvents([event(1), event(3)], [event(3), event(2), event(4)]).map((item) => item.sequence))
      .toEqual([1, 2, 3, 4]);
  });

  it('保留事件关联的 evidenceId，重放时采用服务端最新事件', () => {
    const replayed = mergeReadingEvents(
      [{ ...event(3), evidenceId: 'evidence-old' }],
      [{ ...event(3), evidenceId: 'evidence-current' }],
    );
    expect(replayed[0].evidenceId).toBe('evidence-current');
  });

  it('只为 queued/running 任务继续轮询', () => {
    expect(isReadingTaskActive('queued')).toBe(true);
    expect(isReadingTaskActive('running')).toBe(true);
    expect(isReadingTaskActive('partial')).toBe(false);
    expect(isReadingTaskActive('completed')).toBe(false);
    expect(isReadingTaskActive('failed')).toBe(false);
    expect(isReadingTaskActive('cancelled')).toBe(false);
  });

  it('预算用时显示不超过服务端声明的上限', () => {
    expect(boundedBudgetUsage(15 * 60_000, 10 * 60_000)).toBe(10 * 60_000);
    expect(boundedBudgetUsage(8_000, 10_000)).toBe(8_000);
    expect(boundedBudgetUsage(-1, 10_000)).toBe(0);
  });

  it('按 toolCallId 合并调用、返回、Evidence、恢复和同轮模型预算', () => {
    const events: ReadingEvent[] = [
      { ...event(1, 'budget_updated'), modelCallId: 'model-1', toolCallId: undefined, payload: payload({ kind: 'budget', title: '预算已更新', detail: { cause: 'model_call', delta: { modelTurns: 1 } } }) },
      { ...event(2, 'tool_started'), modelCallId: 'model-1', toolCallId: 'tool-1', payload: payload({ title: '调用 book_read', detail: { phase: 'started', purpose: '读取证据' } }) },
      { ...event(3, 'evidence_recorded'), modelCallId: 'model-1', toolCallId: 'tool-1', evidenceId: 'evidence-1', payload: payload({ kind: 'evidence', title: '记录证据', detail: { quote: '证据' } }) },
      { ...event(4, 'tool_observation'), modelCallId: 'model-1', toolCallId: 'tool-1', payload: payload({ summary: '读取完成', detail: { phase: 'completed', result: { excerpt: '证据' } } }) },
      { ...event(5, 'recovery_attempted'), modelCallId: 'model-1', toolCallId: 'tool-1', payload: payload({ kind: 'recovery', title: '恢复', detail: { errorCode: 'RETRY' } }) },
    ];

    const groups = groupReadingEvents(events, 'running');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ startSequence: 1, endSequence: 5, status: 'completed', toolCallId: 'tool-1' });
    expect(groups[0].events.map((item) => item.sequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it('同名 toolCallId 在不同 modelCallId 下分组，并标记终态未返回调用', () => {
    const groups = groupReadingEvents([
      { ...event(1, 'tool_started'), modelCallId: 'model-a', toolCallId: 'same', payload: payload({ detail: { phase: 'started' } }) },
      { ...event(2, 'tool_started'), modelCallId: 'model-b', toolCallId: 'same', payload: payload({ detail: { phase: 'started' } }) },
    ], 'failed');
    expect(groups).toHaveLength(2);
    expect(groups.every((item) => item.status === 'interrupted')).toBe(true);
  });

  it('旧版事件已有 tool_observation 时不因任务终态误报为已中断', () => {
    const legacyPayload = (title: string) => ({
      schemaVersion: 1 as const,
      legacy: true as const,
      kind: 'tool' as const,
      title,
      toolName: 'book_toc',
      detail: { unavailable: true as const },
    });
    const groups = groupReadingEvents([
      { ...event(1, 'tool_started'), modelCallId: 'model-old', toolCallId: 'tool-old', payload: legacyPayload('调用 book_toc') },
      { ...event(2, 'tool_observation'), modelCallId: 'model-old', toolCallId: 'tool-old', payload: legacyPayload('完成 book_toc') },
    ], 'partial');

    expect(groups).toHaveLength(1);
    expect(groups[0].status).toBe('completed');
  });

  it('历史 evidence import 事件本身可证明工具成功，不误报为已中断', () => {
    const groups = groupReadingEvents([
      { ...event(1, 'tool_started'), modelCallId: 'model-import', toolCallId: 'tool-import', payload: payload({ title: '调用 conversation_import_evidence', toolName: 'conversation_import_evidence', detail: { phase: 'started' } }) },
      { ...event(2, 'evidence_imported'), modelCallId: 'model-import', toolCallId: 'tool-import', payload: payload({ kind: 'evidence', title: '已导入历史证据', summary: '已核验并导入 6 条历史证据', detail: { evidenceIds: ['evidence-1'] } }) },
    ], 'completed');

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ status: 'completed', toolCallId: 'tool-import' });
  });

  it('最新 plan_updated 事件立即覆盖尚未刷新的任务详情计划', () => {
    const task = { plan: [{ id: 'old', title: '旧计划', status: 'pending' }] } as ReadingTaskDetail;
    const planEvent: ReadingEvent = {
      ...event(7, 'plan_updated'),
      payload: payload({
        kind: 'plan',
        title: '更新计划',
        detail: {
          before: [{ id: 'old', title: '旧计划', status: 'pending' }],
          after: [{ id: 'new', title: '立即可见的新计划', status: 'in_progress' }],
          nextAction: '继续阅读',
        },
      }),
    };
    expect(latestPublicPlan(task, [planEvent])).toEqual([
      { id: 'new', title: '立即可见的新计划', status: 'in_progress', agentRunId: 'agent-1' },
    ]);
  });
});

function answerEvent(sequence: number, type: string, detail: Record<string, unknown>): ReadingEvent {
  return {
    sequence, type, createdAt: '2026-08-20T00:00:00.000Z', agentRunId: 'root-1', parentRunId: null,
    payload: { schemaVersion: 2, kind: 'answer', title: '生成回答', detail } as ReadingEvent['payload'],
  };
}

describe('AI 阅读 Citation 导航', () => {
  it('按 CFI、章节 TextQuote、href/fragment 生成降级链', () => {
    expect(buildCitationAttempts({
      version: 1,
      bookId: 9,
      contentRevision: {
        fileChecksum: 'sha256:book',
        extractorVersion: 'epub-v1',
        normalizationVersion: 'text-v1',
      },
      position: { kind: 'epub_text', sectionIndex: 4, start: 10, end: 18 },
      textQuote: { exact: '自由的阅读', prefix: '追求', suffix: '需要工具' },
      readerAnchor: { epubcfi: 'epubcfi(/6/10!/4/2)' },
      structure: { href: 'text/chapter-4.xhtml', fragment: 'agent' },
    })).toEqual([
      { kind: 'cfi', epubcfi: 'epubcfi(/6/10!/4/2)' },
      {
        kind: 'text_quote',
        sectionIndex: 4,
        textQuote: { exact: '自由的阅读', prefix: '追求', suffix: '需要工具' },
      },
      { kind: 'href', href: 'text/chapter-4.xhtml#agent' },
    ]);
  });

  it('缺少有效定位时不生成跳到书首的兜底目标', () => {
    expect(buildCitationAttempts({
      version: 1,
      bookId: 9,
      contentRevision: {
        fileChecksum: 'sha256:book',
        extractorVersion: 'epub-v1',
        normalizationVersion: 'text-v1',
      },
      position: { kind: 'epub_text', sectionIndex: -1, start: 0, end: 0 },
    })).toEqual([]);
  });
});
