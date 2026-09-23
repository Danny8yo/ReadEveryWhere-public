// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import ConversationComposer from '../components/ai-reading/ConversationComposer.vue';
import ConversationTurnList from '../components/ai-reading/ConversationTurnList.vue';
import { createBudgetSelection } from '../features/ai-reading/domain/budget';
import type {
  ReadingBudgetConfig,
  ReadingBudgetSelection,
  ReadingConversationTurnDetail,
  ReadingEvent,
} from '../features/ai-reading/model/aiReading';

describe('连续对话组件', () => {
  it('活动 turn 禁用输入并提供停止，needs_input 显示澄清问题', async () => {
    const active = mountComposer({ active: true });
    expect(active.get('textarea').attributes('disabled')).toBeDefined();
    await active.get('button').trigger('click');
    expect(active.emitted('cancel')).toHaveLength(1);

    const needsInput = mountComposer({ needsInput: true, clarificationQuestion: '你指的是第三章还是第四章？' });
    expect(needsInput.text()).toContain('你指的是第三章还是第四章？');
  });

  it('冻结会话不接受输入，只提供基于当前版本新建会话', async () => {
    const wrapper = mountComposer({ frozen: true });
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('基于当前版本新建会话');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('new-conversation')).toHaveLength(1);
  });

  it('自定义预算暂时无效时仍可编辑字段或切回预设，只有发送按钮禁用', () => {
    const invalid = {
      ...createBudgetSelection(budgetConfig),
      budgetMode: 'custom' as const,
      budgetPolicy: { ...budgetConfig.presets.standard, maxToolCalls: 2 },
    };
    const wrapper = mountComposer({
      message: '请阅读这一章',
      budget: invalid,
      budgetConfig,
      budgetValid: false,
    });

    expect(wrapper.get('[data-budget-mode="quick"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('input[name="maxToolCalls"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('.composer-button.primary').attributes('disabled')).toBeDefined();
  });

  it('预算编辑区由明确关闭按钮控制，提交和活动状态不强制折叠', async () => {
    const wrapper = mountComposer({
      message: '请阅读这一章',
      budget: createBudgetSelection(budgetConfig),
      budgetConfig,
    });
    const details = wrapper.get('.composer-budget');
    (details.element as HTMLDetailsElement).open = true;

    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('请阅读这一章');
    expect(wrapper.get('.composer-button.primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.composer-button.primary').trigger('click');
    expect(wrapper.emitted('submit')).toHaveLength(1);
    expect((details.element as HTMLDetailsElement).open).toBe(true);

    await wrapper.setProps({ active: true });
    expect((details.element as HTMLDetailsElement).open).toBe(true);

    const close = wrapper.get('button[aria-label="关闭预算设置"]');
    expect(close.attributes('title')).toBe('关闭预算设置');
    await close.trigger('click');
    expect((details.element as HTMLDetailsElement).open).toBe(false);
  });

  it('turn 结果只从当前 task evidence 发出 Citation', async () => {
    const turn = turnDetail();
    const wrapper = mount(ConversationTurnList, { props: { turns: [turn] } });
    await wrapper.get('.evidence-list button').trigger('click');
    expect(wrapper.emitted('citation')?.[0]?.[0]).toMatchObject({ id: 'evidence-current' });
  });

  it('用户输入是可选择文本，并提供独立复制按钮', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const turn = turnDetail();
    const wrapper = mount(ConversationTurnList, { props: { turns: [turn] } });

    expect(wrapper.get('.turn-user-text').element.tagName).toBe('P');
    expect(wrapper.get('.turn-user-text').text()).toBe(turn.userInput);
    await wrapper.get('.turn-user-copy').trigger('click');
    expect(writeText).toHaveBeenCalledWith(turn.userInput);
    expect(wrapper.get('.turn-user-copy').attributes('aria-label')).toBe('已复制');
  });

  it('活动轮次内联展示流式回答和工具过程，并允许折叠过程摘要', async () => {
    const turn = turnDetail();
    turn.status = 'running';
    turn.task!.status = 'running';
    turn.task!.result = null;
    const wrapper = mount(ConversationTurnList, {
      props: {
        turns: [turn], selectedTurnId: turn.id,
        events: [
          {
            sequence: 1, type: 'agent_progress', createdAt: '2026-08-20T00:00:00.000Z',
            agentRunId: 'root-1', parentRunId: null, modelCallId: 'model-1',
            payload: { schemaVersion: 2, kind: 'commentary', title: 'Agent 执行说明',
              summary: '我先读取这一章，再核对作者的核心论点。',
              detail: { phase: 'completed', text: '我先读取这一章，再核对作者的核心论点。' } },
          },
          {
            sequence: 2, type: 'tool_started', createdAt: '2026-08-20T00:00:01.000Z',
            agentRunId: 'root-1', parentRunId: null, toolCallId: 'tool-1', modelCallId: 'model-1',
            payload: { schemaVersion: 2, kind: 'tool', title: '调用 book_read', toolName: 'book_read',
              summary: '读取正文', detail: { phase: 'started', purpose: '读取正文', arguments: {} } },
          },
          answerEventForComponent(3, 'answer_started', { phase: 'started', answerId: 'answer-1', mode: 'model' }),
          answerEventForComponent(4, 'answer_delta', { phase: 'streaming', answerId: 'answer-1', offset: 0, delta: '作者首先区分了两种变化。' }),
        ],
      },
    });

    expect(wrapper.text()).toContain('作者首先区分了两种变化。');
    expect(wrapper.text()).toContain('我先读取这一章，再核对作者的核心论点。');
    expect(wrapper.text()).toContain('book_read');
    const executionRows = wrapper.findAll('.execution-list > li');
    expect(executionRows[0].classes()).toContain('commentary-row');
    expect(executionRows[1].classes()).toContain('tool-row');
    const toggle = wrapper.get('button[aria-expanded="true"]');
    expect(toggle.text()).toContain('隐藏过程');
    await toggle.trigger('click');
    expect(wrapper.text()).toContain('查看过程');
    expect(wrapper.text()).not.toContain('调用 book_read');
  });

  it('在折叠摘要和展开预算中展示 Provider Token 与缓存命中率', async () => {
    const turn = turnDetail();
    Object.assign(turn.task!.budget.used, {
      promptTokens: 147_273,
      completionTokens: 21_614,
      totalTokens: 168_887,
      cacheReadInputTokens: 64_128,
      cacheWriteInputTokens: null,
      uncachedInputTokens: 83_145,
    });
    const wrapper = mount(ConversationTurnList, {
      props: { turns: [turn], selectedTurnId: turn.id },
    });
    const toggle = wrapper.get('button[aria-expanded="false"]');

    expect(toggle.text()).toContain('168.9k Token');
    expect(toggle.text()).toContain('缓存 43.5%');
    await toggle.trigger('click');

    const usage = wrapper.get('[aria-label="本轮预算"]');
    expect(usage.text()).toContain('147.3k输入 Token');
    expect(usage.text()).toContain('21.6k输出 Token');
    expect(usage.text()).toContain('168.9k总 Token');
    expect(usage.text()).toContain('64.1k缓存命中');
    expect(usage.text()).toContain('83.1k缓存未命中');
    expect(usage.text()).toContain('43.5%命中率');
    expect(usage.text()).toContain('未报告缓存写入');
  });

  it('不把 Provider 未报告的缓存分项当作零命中', async () => {
    const turn = turnDetail();
    Object.assign(turn.task!.budget.used, {
      promptTokens: 10,
      completionTokens: 0,
      totalTokens: 10,
      cacheReadInputTokens: null,
      cacheWriteInputTokens: null,
      uncachedInputTokens: null,
    });
    const wrapper = mount(ConversationTurnList, {
      props: { turns: [turn], selectedTurnId: turn.id },
    });
    const toggle = wrapper.get('button[aria-expanded="false"]');
    expect(toggle.text()).toContain('10 Token');
    expect(toggle.text()).toContain('缓存 未报告');
    await toggle.trigger('click');

    expect(wrapper.get('[aria-label="本轮预算"]').text()).toContain('未报告命中率');
    expect(wrapper.text()).not.toContain('缓存 0.0%');
  });

  it('保留 Provider 零 Token，且缺失 usage 时不伪造计量', async () => {
    const zeroTurn = turnDetail();
    Object.assign(zeroTurn.task!.budget.used, {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: null,
      uncachedInputTokens: 0,
    });
    const zeroWrapper = mount(ConversationTurnList, {
      props: { turns: [zeroTurn], selectedTurnId: zeroTurn.id },
    });
    expect(zeroWrapper.get('button[aria-expanded="false"]').text()).toContain('0 Token');
    expect(zeroWrapper.text()).not.toContain('缓存 0.0%');

    const missingTurn = turnDetail();
    const missingWrapper = mount(ConversationTurnList, {
      props: { turns: [missingTurn], selectedTurnId: missingTurn.id },
    });
    expect(missingWrapper.get('button[aria-expanded="false"]').text()).not.toContain('Token');
    await missingWrapper.get('button[aria-expanded="false"]').trigger('click');
    expect(missingWrapper.get('[aria-label="本轮预算"]').text()).not.toContain('输入 Token');
  });

  it('重试轮只展示稳定失败码和受限证据候选预览', () => {
    const turn = turnDetail();
    turn.id = 'turn-2';
    turn.turnNumber = 2;
    turn.retryOfTurnId = 'turn-1';
    turn.retrySource = {
      sourceTurnId: 'turn-1', sourceStatus: 'failed', failureCode: 'MODEL_CONNECTION_FAILED',
      evidenceCandidates: [{
        sourceEvidenceId: 'source-evidence-1', chapterPath: '第三章', quotePreview: '失败前已核验的证据预览',
      }],
    };
    const wrapper = mount(ConversationTurnList, { props: { turns: [turn] } });

    expect(wrapper.text()).toContain('来源轮失败：MODEL_CONNECTION_FAILED');
    expect(wrapper.text()).toContain('第三章');
    expect(wrapper.text()).toContain('失败前已核验的证据预览');
    expect(wrapper.html()).not.toContain('sourceTextHash');
    expect(wrapper.html()).not.toContain('sourceLocator');
  });
});

function mountComposer(extra: Record<string, unknown>) {
  const wrapper = mount(ConversationComposer, {
    props: {
      message: '',
      budget: null,
      budgetConfig: null,
      budgetValid: true,
      ...extra,
    },
  });
  wrapper.setProps({
    'onUpdate:message': (message: string) => wrapper.setProps({ message }),
    'onUpdate:budget': (budget: ReadingBudgetSelection | null) => wrapper.setProps({ budget }),
  });
  return wrapper;
}

function turnDetail(): ReadingConversationTurnDetail {
  const evidence = {
    id: 'evidence-current', quote: '当前任务证据',
    citation: {
      bookId: 11, bookTitle: '书', authors: [], chapterPath: '第一章',
      locator: {
        version: 1 as const, bookId: 11,
        contentRevision: { fileChecksum: 'sha256:x', extractorVersion: '1', normalizationVersion: '1' },
        position: { kind: 'epub_text' as const, sectionIndex: 0, start: 0, end: 6 },
      },
    },
  };
  return {
    id: 'turn-1', conversationId: 'conversation-1', taskId: 'task-1', turnNumber: 1,
    userInput: '引用依据', status: 'completed', createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:01:00.000Z',
    task: {
      id: 'task-1', bookId: 11, goal: '理解全书', budgetTier: 'quick', budgetMode: 'preset', status: 'completed',
      createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:01:00.000Z',
      contentRevision: { fileChecksum: 'sha256:x', extractorVersion: '1', normalizationVersion: '1' },
      plan: [], agents: [], budget: { limits: counters(), used: counters(), remaining: counters() },
      result: { bookFindings: [{ id: 'finding-1', statement: '结论', evidenceIds: ['evidence-current'] }], inferences: [], modelKnowledge: [], openQuestions: [], limitations: [] },
      evidence: [evidence],
    },
  };
}

function counters() {
  return { modelTurns: 0, toolCalls: 0, readCharacters: 0, durationMs: 0, delegatedAgents: 0, concurrentAgents: 0 };
}

function answerEventForComponent(sequence: number, type: string, detail: Record<string, unknown>): ReadingEvent {
  return {
    sequence, type, createdAt: '2026-08-20T00:00:00.000Z', agentRunId: 'root-1', parentRunId: null,
    payload: { schemaVersion: 2, kind: 'answer', title: '生成回答', detail } as ReadingEvent['payload'],
  };
}

const budgetConfig: ReadingBudgetConfig = {
  version: 2,
  presets: {
    quick: { maxModelTurns: 60, maxToolCalls: 90, maxReadCharacters: 250_000, maxDurationMs: 30 * 60_000, maxDelegatedAgents: 6, maxConcurrentAgents: 3 },
    standard: { maxModelTurns: 90, maxToolCalls: 135, maxReadCharacters: 500_000, maxDurationMs: 45 * 60_000, maxDelegatedAgents: 6, maxConcurrentAgents: 3 },
    deep: { maxModelTurns: 120, maxToolCalls: 180, maxReadCharacters: 750_000, maxDurationMs: 60 * 60_000, maxDelegatedAgents: 6, maxConcurrentAgents: 3 },
  },
  constraints: {
    maxModelTurns: { min: 3, max: 200, step: 1 }, maxToolCalls: { min: 3, max: 300, step: 1 },
    maxReadCharacters: { min: 4_000, max: 2_000_000, step: 1 }, maxDurationMs: { min: 60_000, max: 7_200_000, step: 60_000 },
    maxDelegatedAgents: { min: 0, max: 12, step: 1 }, maxConcurrentAgents: { min: 0, max: 3, step: 1 },
  },
};
