import { AiReadingApplicationError } from './application-error';
import { ReadingConversationService } from './reading-conversation.service';

const REVISION = { fileChecksum: 'sha256:v1', extractorVersion: 'epub-1', normalizationVersion: 'text-1' };
const FORMAL_PROFILE = {
  profileId: 'profile-1', primaryGenre: 'narrative', secondaryGenres: ['general'], traits: ['character-driven'],
  confidence: { kind: 'ai-score' as const, score: 0.91 },
  classificationSummary: 'The book is organized around a character arc.',
  profileVersion: 3, updatedAt: '2026-08-08T00:00:00.000Z',
};
const PROFILE = {
  ...FORMAL_PROFILE,
  contentRevision: REVISION,
  spoilerPolicy: 'avoid_unless_user_requests' as const,
};

describe('ReadingConversationService', () => {
  it('creates a first conversation turn with a new task and frozen profile', async () => {
    const value = fixture();

    const result = await value.service.createConversation(7, {
      bookId: 42, message: '解释作者为何这样安排前三章', budgetTier: 'quick',
      readerFocus: { sectionIndex: 3, chapterLabel: 'untrusted label' },
    }, 'request-1');

    expect(value.store.createWithTurn).toHaveBeenCalledWith(expect.objectContaining({ maxActiveTurns: 2 }));
    const call = value.store.createWithTurn.mock.calls[0][0];
    expect(call.conversation.toJSON().profileSnapshot).toEqual(PROFILE);
    expect(call.turn.taskId).toBe(call.task.id);
    expect(result).toMatchObject({ status: 'active', turns: [{ turnNumber: 1, status: 'queued' }] });
  });

  it('freezes a user-determined profile without fabricated AI provenance', async () => {
    const value = fixture({
      formalProfile: {
        ...FORMAL_PROFILE,
        confidence: { kind: 'user-determined' },
        classificationSummary: null,
        profileVersion: 4,
      },
    });

    await value.service.createConversation(7, {
      bookId: 42, message: '解释前三章', budgetTier: 'quick',
    });

    const snapshot = value.store.createWithTurn.mock.calls[0][0].conversation.toJSON().profileSnapshot;
    expect(snapshot).toMatchObject({
      profileId: 'profile-1',
      profileVersion: 4,
      confidence: { kind: 'user-determined' },
      contentRevision: REVISION,
    });
    expect(snapshot).not.toHaveProperty('modelId');
    expect(snapshot).not.toHaveProperty('strategyVersion');
    expect(snapshot).not.toHaveProperty('analyzedAt');
  });

  it('rejects reasoning models before creating a tool-based conversation', async () => {
    const value = fixture({ modelId: 'deepseek-reasoner' });

    await expect(value.service.createConversation(7, {
      bookId: 42, message: '解释前三章', budgetTier: 'quick',
    })).rejects.toMatchObject({
      kind: 'unsupported_model',
      details: { field: 'modelId', reason: 'DEEPSEEK_MODEL_UNSUPPORTED' },
    });
    expect(value.store.createWithTurn).not.toHaveBeenCalled();
    expect(value.analysis.getAccess).not.toHaveBeenCalled();
  });

  it.each([
    ['not_analyzed', 'BOOK_ANALYSIS_REQUIRED'],
    ['pending', 'BOOK_ANALYSIS_IN_PROGRESS'],
    ['running', 'BOOK_ANALYSIS_IN_PROGRESS'],
    ['failed', 'BOOK_ANALYSIS_FAILED'],
    ['stale', 'BOOK_ANALYSIS_REQUIRED'],
    ['unsupported', 'BOOK_ANALYSIS_UNSUPPORTED'],
  ] as const)('rejects analysis state %s with stable reason %s', async (analysisStatus, reason) => {
    const value = fixture({ analysisStatus });

    await expect(value.service.createConversation(7, {
      bookId: 42, message: '解释前三章', budgetTier: 'quick',
    })).rejects.toMatchObject({
      kind: 'conflict',
      details: { field: 'bookAnalysis', reason },
    });
    expect(value.store.createWithTurn).not.toHaveBeenCalled();
    expect(value.readingTools.preflight).not.toHaveBeenCalled();
  });

  it('creates each follow-up as a new task whose execution goal is the current message', async () => {
    const value = fixture();
    value.store.findForUser.mockReturnValue(value.conversation);
    value.store.listTurns.mockReturnValue({ items: [value.turn], hasMore: false, nextBeforeTurnNumber: null });

    const result = await value.service.createTurn(7, 'conversation-1', {
      message: '换个角度解释上一条', budgetTier: 'standard',
    });

    const call = value.store.addTurn.mock.calls[0][0];
    expect(call.turn.taskId).not.toBe(value.turn.taskId);
    expect(call.turn.turnNumber).toBe(2);
    expect(call.task.goal).toBe('换个角度解释上一条');
    expect(call.conversation.rootGoal).toBe(value.conversation.rootGoal);
    expect(result.turn).toMatchObject({ turnNumber: 2, status: 'queued' });
  });

  it('persists a permanent freeze before rejecting a changed revision', async () => {
    const value = fixture({ revision: { ...REVISION, fileChecksum: 'sha256:v2' } });
    value.store.findForUser.mockReturnValue(value.conversation);

    await expect(value.service.createTurn(7, 'conversation-1', {
      message: '继续解释', budgetTier: 'quick',
    })).rejects.toMatchObject({ details: { reason: 'CONVERSATION_REVISION_CHANGED' } });
    expect(value.store.saveConversation).toHaveBeenCalledWith(expect.objectContaining({ status: 'frozen' }));
  });

  it('maps active-turn and service limits to stable conflict reasons', async () => {
    const active = fixture({ addResult: 'conversation_turn_active' });
    active.store.findForUser.mockReturnValue(active.conversation);
    active.store.listTurns.mockReturnValue({ items: [terminal(active.turn)], hasMore: false, nextBeforeTurnNumber: null });
    await expect(active.service.createTurn(7, 'conversation-1', { message: '继续', budgetTier: 'quick' }))
      .rejects.toMatchObject({ details: { reason: 'CONVERSATION_TURN_ACTIVE' } });

    const service = fixture({ addResult: 'service_turn_limit' });
    service.store.findForUser.mockReturnValue(service.conversation);
    service.store.listTurns.mockReturnValue({ items: [terminal(service.turn)], hasMore: false, nextBeforeTurnNumber: null });
    await expect(service.service.createTurn(7, 'conversation-1', { message: '继续', budgetTier: 'quick' }))
      .rejects.toMatchObject({ details: { reason: 'AI_READING_TURN_CAPACITY' } });
  });

  it('retries only a failed turn and creates another task', async () => {
    const value = fixture();
    value.store.findForUser.mockReturnValue(value.conversation);
    value.turn.complete('failed', '2026-08-16T00:01:00.000Z');
    value.store.findTurnForUser.mockReturnValue(value.turn);
    value.store.listTurns.mockReturnValue({ items: [value.turn], hasMore: false, nextBeforeTurnNumber: null });
    value.tasks.findForUser.mockReturnValue({
      scope: { bookId: '42', contentRevision: JSON.stringify(REVISION) },
      toJSON: () => ({ terminalReason: 'MODEL_CONNECTION_FAILED' }),
    });
    value.evidence.listForTask.mockReturnValue([{
      evidenceId: 'source-evidence-1', taskId: 'task-1', agentRunId: 'root-task-1',
      quote: '这是失败前已经核验、可由重试轮显式导入的证据。',
      citation: {
        bookId: '42', contentRevision: JSON.stringify(REVISION), chapterPath: '第三章',
        locator: { version: 1, position: { kind: 'epub_text', sectionIndex: 3, start: 10, end: 35 } },
      },
      sourceTextHash: 'a'.repeat(64), sourceLocator: { version: 1 }, provenanceKind: 'read',
      createdAt: '2026-08-16T00:00:30.000Z',
    }]);

    const result = await value.service.retryTurn(7, 'conversation-1', 'turn-1', {});

    expect(result.turn).toMatchObject({
      retryOfTurnId: 'turn-1', turnNumber: 2, status: 'queued',
      retrySource: {
        sourceTurnId: 'turn-1', sourceStatus: 'failed', failureCode: 'MODEL_CONNECTION_FAILED',
        evidenceCandidates: [{
          sourceEvidenceId: 'source-evidence-1', chapterPath: '第三章',
          quotePreview: '这是失败前已经核验、可由重试轮显式导入的证据。',
        }],
      },
    });
    expect(result.turn.taskId).not.toBe('task-1');
    expect(value.store.addTurn.mock.calls[0][0].task.goal).toBe(value.turn.userInput);
  });

  it('uses an explicit retry message as the new task execution goal', async () => {
    const value = fixture();
    value.store.findForUser.mockReturnValue(value.conversation);
    value.turn.complete('failed', '2026-08-16T00:01:00.000Z');
    value.store.findTurnForUser.mockReturnValue(value.turn);
    value.store.listTurns.mockReturnValue({ items: [value.turn], hasMore: false, nextBeforeTurnNumber: null });

    await value.service.retryTurn(7, 'conversation-1', 'turn-1', {
      message: '只重试第三章的论证', budgetTier: 'deep',
    });

    const call = value.store.addTurn.mock.calls[0][0];
    expect(call.turn.userInput).toBe('只重试第三章的论证');
    expect(call.task.goal).toBe('只重试第三章的论证');
  });

  it('fails closed with a stable 404 reason when conversations are disabled', async () => {
    const value = fixture({ enabled: false });

    await expect(value.service.createConversation(7, {
      bookId: 42, message: '不应创建会话', budgetTier: 'quick',
    })).rejects.toMatchObject({
      kind: 'disabled',
      details: { reason: 'CONVERSATIONS_DISABLED' },
    });
    expect(value.store.createWithTurn).not.toHaveBeenCalled();

    for (const action of [
      () => value.service.listConversations(7, 42, 1, 20),
      () => value.service.deleteConversation(7, 'conversation-1'),
    ]) {
      try {
        action();
        throw new Error('expected disabled conversation route to fail');
      } catch (error) {
        expect(error).toMatchObject({ kind: 'disabled', details: { reason: 'CONVERSATIONS_DISABLED' } });
      }
    }
  });

  it('rejects deleting an active conversation with a stable reason', () => {
    const value = fixture({ deleteResult: 'active' });
    try {
      value.service.deleteConversation(7, 'conversation-1');
      throw new Error('expected deletion to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AiReadingApplicationError);
      expect(error).toMatchObject({ details: { reason: 'CONVERSATION_TURN_ACTIVE' } });
    }
  });

  it('returns cumulative token usage for conversation list and detail', () => {
    const value = fixture();
    value.store.findForUser.mockReturnValue(value.conversation);
    value.store.listForBook.mockReturnValue({
      items: [value.conversation], total: 1, page: 1, pageSize: 20,
    });
    value.store.listTurns.mockReturnValue({ items: [value.turn], hasMore: false, nextBeforeTurnNumber: null });
    value.store.usageForConversation.mockReturnValue({
      promptTokens: 120, completionTokens: 40, totalTokens: 160,
    });

    expect(value.service.listConversations(7, 42, 1, 20).items[0]).toMatchObject({
      usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160 },
    });
    expect(value.service.getConversation(7, 'conversation-1')).toMatchObject({
      usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160 },
    });
  });
});

function fixture(options: {
  revision?: typeof REVISION;
  addResult?: 'created' | 'conversation_turn_active' | 'service_turn_limit';
  deleteResult?: 'deleted' | 'not_found' | 'active';
  enabled?: boolean;
  modelId?: string;
  analysisStatus?: 'not_analyzed' | 'pending' | 'running' | 'failed' | 'stale' | 'unsupported' | 'ready';
  formalProfile?: Omit<typeof FORMAL_PROFILE, 'confidence' | 'classificationSummary'> & {
    confidence: { kind: 'ai-score'; score: number } | { kind: 'user-determined' };
    classificationSummary: string | null;
  };
} = {}) {
  const domain = require('../domain') as typeof import('../domain');
  const conversation = domain.ReadingConversation.create({
    id: 'conversation-1', userId: '7', bookId: '42', contentRevision: JSON.stringify(REVISION),
    rootGoal: '解释作者为何这样安排前三章', profileSnapshot: PROFILE, now: '2026-08-16T00:00:00.000Z',
  });
  const turn = domain.ConversationTurn.create({
    id: 'turn-1', conversationId: 'conversation-1', taskId: 'task-1', turnNumber: 1,
    userInput: '解释作者为何这样安排前三章', now: '2026-08-16T00:00:00.000Z',
  });
  const store = {
    createWithTurn: jest.fn().mockReturnValue('created'),
    addTurn: jest.fn().mockReturnValue(options.addResult ?? 'created'),
    findForUser: jest.fn(), listForBook: jest.fn(), findTurnForUser: jest.fn(),
    listTurns: jest.fn(), latestCheckpoint: jest.fn().mockReturnValue(null),
    usageForConversation: jest.fn().mockReturnValue({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
    saveConversation: jest.fn(), deleteForUser: jest.fn().mockReturnValue(options.deleteResult ?? 'deleted'),
  };
  const modelConfigs = {
    getCredential: jest.fn().mockReturnValue({
      provider: 'deepseek', apiKey: 'test-key', modelId: options.modelId ?? 'deepseek-v4-flash',
    }),
  };
  const analysisStatus = options.analysisStatus ?? 'ready';
  const analysis = { getAccess: jest.fn().mockResolvedValue({
    status: analysisStatus,
    stale: analysisStatus === 'stale',
    profile: analysisStatus === 'ready' ? (options.formalProfile ?? FORMAL_PROFILE) : null,
  }) };
  const readingTools = {
    inspectOwnedBook: jest.fn().mockResolvedValue({ contentRevision: options.revision ?? REVISION }),
    preflight: jest.fn().mockResolvedValue(undefined),
  };
  const tasks = { findForUser: jest.fn() };
  const evidence = { listForTask: jest.fn().mockReturnValue([]) };
  const modelCapabilities = {
    assertCapability: jest.fn((_providerId: string, modelId: string) => {
      if (modelId === 'deepseek-reasoner') throw new Error('unsupported');
      return {};
    }),
  };
  return {
    conversation, turn, store, tasks, evidence, analysis, readingTools,
    service: new ReadingConversationService(
      modelConfigs as never, store as never, readingTools as never, analysis as never,
      tasks as never, evidence as never,
      { maxActiveTurns: 2, enabled: options.enabled ?? true },
      modelCapabilities as never,
    ),
  };
}

function terminal(turn: any) {
  turn.complete('failed', '2026-08-16T00:01:00.000Z');
  return turn;
}
