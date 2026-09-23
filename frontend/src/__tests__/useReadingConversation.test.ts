// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getBudgetConfig: vi.fn(),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  listConversationTurns: vi.fn(),
  getConversationTurn: vi.fn(),
  listConversationTurnEvents: vi.fn(),
  createConversation: vi.fn(),
  createConversationTurn: vi.fn(),
  retryConversationTurn: vi.fn(),
  cancelConversationTurn: vi.fn(),
  deleteConversation: vi.fn(),
}));

vi.mock('../features/ai-reading/api/aiReadingApi', () => ({ aiReadingApi: api }));

import { useReadingConversation } from '../composables/useReadingConversation';
import type { ReadingConversationDetail, ReadingConversationTurnDetail } from '../features/ai-reading/model/aiReading';

let state: ReturnType<typeof useReadingConversation> | undefined;
const Harness = defineComponent({
  setup() {
    state = useReadingConversation(11, { pollIntervalMs: 50 });
    return state;
  },
  template: '<div><span class="active">{{ currentTurnActive }}</span><span class="frozen">{{ currentConversationFrozen }}</span><span class="events">{{ events.length }}</span></div>',
});

describe('useReadingConversation 连续 turn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    state = undefined;
    api.getBudgetConfig.mockResolvedValue({ version: 1, presets: {}, constraints: {} });
    api.listConversations.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  afterEach(() => vi.useRealTimers());

  it('恢复活动 turn，并始终从已合并的事件 sequence 继续轮询', async () => {
    const turn = turnDetail('running');
    const conversation = conversationDetail(turn);
    api.listConversations.mockResolvedValue({ items: [conversation], total: 1, page: 1, pageSize: 20 });
    api.getConversation.mockResolvedValue(conversation);
    api.listConversationTurns.mockResolvedValue({ items: [turn], nextBeforeTurnNumber: null, hasMore: false });
    api.getConversationTurn.mockResolvedValue(turn);
    api.listConversationTurnEvents
      .mockResolvedValueOnce({ items: [{ ...event(4), type: 'agent_started' }], nextSequence: 4, hasMore: false })
      .mockResolvedValue({ items: [], nextSequence: 4, hasMore: false });

    const wrapper = mount(Harness);
    await flushPromises();
    expect(wrapper.get('.active').text()).toBe('true');
    expect(wrapper.get('.events').text()).toBe('1');

    await vi.advanceTimersToNextTimerAsync();
    await flushPromises();
    expect(api.listConversationTurnEvents.mock.calls.at(-1)?.[2]).toBe(4);
    wrapper.unmount();
  });

  it('同会话活动 turn 时拒绝本地重复提交，终态后创建新 turn', async () => {
    const wrapper = mount(Harness);
    await flushPromises();
    state!.currentConversation.value = conversationDetail(turnDetail('running'));
    state!.currentTurn.value = turnDetail('running');

    const rejected = await state!.sendTurn('解释上一条', budgetSelection());
    expect(rejected).toBeNull();
    expect(api.createConversationTurn).not.toHaveBeenCalled();

    state!.currentTurn.value = turnDetail('completed');
    const next = turnDetail('queued', 2);
    api.createConversationTurn.mockResolvedValue({
      conversation: conversationDetail(next),
      turn: next,
    });
    const created = await state!.sendTurn('解释上一条', budgetSelection());
    expect(created?.turnNumber).toBe(2);
    expect(api.createConversationTurn).toHaveBeenCalledWith('conversation-1', {
      message: '解释上一条',
      budgetTier: 'quick',
    });
    wrapper.unmount();
  });

  it('冻结会话不允许追问，也不允许 Citation 跳转', async () => {
    const wrapper = mount(Harness);
    await flushPromises();
    state!.currentConversation.value = { ...conversationDetail(turnDetail('completed')), status: 'frozen' };
    state!.currentTurn.value = turnDetail('completed');
    expect(state!.currentConversationFrozen.value).toBe(true);
    expect(state!.canNavigateCitation.value).toBe(false);
    expect(await state!.sendTurn('继续', budgetSelection())).toBeNull();
    expect(api.createConversationTurn).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('无活动会话时仍恢复最近一条历史会话', async () => {
    const turn = turnDetail('completed');
    const conversation = conversationDetail(turn);
    api.listConversations.mockResolvedValue({ items: [conversation], total: 1, page: 1, pageSize: 20 });
    api.getConversation.mockResolvedValue(conversation);
    api.listConversationTurns.mockResolvedValue({ items: [turn], nextBeforeTurnNumber: null, hasMore: false });
    api.listConversationTurnEvents.mockResolvedValue({ items: [], nextSequence: 0, hasMore: false });

    const wrapper = mount(Harness);
    await flushPromises();
    expect(state!.currentConversation.value?.id).toBe('conversation-1');
    expect(state!.currentTurn.value?.status).toBe('completed');
    wrapper.unmount();
  });
});

function budgetSelection() {
  return {
    budgetTier: 'quick' as const,
    budgetMode: 'preset' as const,
    budgetPolicy: {
      maxModelTurns: 10, maxToolCalls: 15, maxReadCharacters: 30_000,
      maxDurationMs: 180_000, maxDelegatedAgents: 1, maxConcurrentAgents: 1,
    },
  };
}

function conversationDetail(turn: ReadingConversationTurnDetail): ReadingConversationDetail {
  return {
    id: 'conversation-1', bookId: 11, rootGoal: '理解全书', status: 'active',
    contentRevision: { fileChecksum: 'sha256:x', extractorVersion: '1', normalizationVersion: '1' },
    createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z',
    frozenAt: null, frozenReason: null, latestTurn: turn, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}

function turnDetail(status: ReadingConversationTurnDetail['status'], turnNumber = 1): ReadingConversationTurnDetail {
  return {
    id: `turn-${turnNumber}`, conversationId: 'conversation-1', taskId: `task-${turnNumber}`,
    turnNumber, userInput: '理解全书', status, retryOfTurnId: null, readerFocus: null,
    createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z', finishedAt: null,
    task: {
      id: `task-${turnNumber}`, bookId: 11, goal: '理解全书', budgetTier: 'quick', budgetMode: 'preset', status,
      createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z',
      contentRevision: { fileChecksum: 'sha256:x', extractorVersion: '1', normalizationVersion: '1' },
      plan: [], agents: [],
      budget: { limits: counters(), used: counters(), remaining: counters() }, result: null, evidence: [],
    },
  };
}

function counters() {
  return { modelTurns: 0, toolCalls: 0, readCharacters: 0, durationMs: 0, delegatedAgents: 0, concurrentAgents: 0 };
}

function event(sequence: number) {
  return {
    sequence, type: 'agent_started', createdAt: '2026-08-16T00:00:00.000Z',
    agentRunId: 'root-run', parentRunId: null,
    payload: { schemaVersion: 2 as const, kind: 'agent' as const, title: '开始阅读', detail: { role: 'root' as const } },
  };
}
