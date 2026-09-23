import { ConversationCheckpoint, ConversationMemoryV1 } from './conversation-checkpoint';

const NOW = '2026-08-16T00:00:00.000Z';

describe('ConversationCheckpoint', () => {
  it('keeps bounded source-backed working memory and clones it immutably', () => {
    const memory = {
      turnSummaries: [{ turnId: 'turn-1', summary: '第一轮确认了作者的核心论点。' }],
      findings: [{ text: '作者先定义概念，再给出反例。', sourceTurnId: 'turn-1', evidenceIds: ['evidence-1'] }],
      preferences: [{ value: '避免剧透', sourceTurnId: 'turn-1', sourceQuote: '请不要剧透结局' }],
      topics: [{ name: '核心论点', sourceTurnId: 'turn-1', findingIndexes: [0] }],
      openQuestions: ['反例是否覆盖所有情况？'],
      planSteps: [{ text: '继续核对第三章', status: 'pending' as const }],
      chapterRanges: [{ sectionIndex: 3, chapterLabel: '第三章' }],
      sourceEvidenceRefs: [{ sourceTurnId: 'turn-1', sourceTaskId: 'task-1', sourceEvidenceId: 'evidence-1' }],
    };
    const checkpoint = ConversationCheckpoint.create({
      id: 'checkpoint-1', conversationId: 'conversation-1', throughTurnId: 'turn-1',
      memory, now: NOW,
    });
    memory.turnSummaries[0].summary = 'tampered';

    expect(checkpoint.memory.turnSummaries[0].summary).not.toBe('tampered');
    expect(checkpoint.toJSON().characterCount).toBeGreaterThan(0);
    expect(ConversationCheckpoint.fromJSON(checkpoint.toJSON()).toJSON()).toEqual(checkpoint.toJSON());
  });

  it.each([
    ['turnSummaries', 7], ['findings', 21], ['preferences', 11], ['topics', 21],
    ['openQuestions', 11], ['planSteps', 21], ['chapterRanges', 7], ['sourceEvidenceRefs', 49],
  ] as const)('rejects %s beyond its item bound', (field, count) => {
    const memory = emptyMemory() as unknown as Record<string, unknown[]>;
    memory[field] = Array.from({ length: count }, (_, index) => itemFor(field, index));

    expect(() => ConversationCheckpoint.create({
      id: 'checkpoint-1', conversationId: 'conversation-1', throughTurnId: 'turn-1',
      memory: memory as never, now: NOW,
    })).toThrow('CONVERSATION_CHECKPOINT_LIMIT_EXCEEDED');
  });

  it('rejects preference and topic entries without traceable sources', () => {
    expect(() => createWith({
      ...emptyMemory(), preferences: [{ value: '不要剧透', sourceTurnId: 'turn-1', sourceQuote: '' }],
    })).toThrow('CONVERSATION_CHECKPOINT_SOURCE_INVALID');
    expect(() => createWith({
      ...emptyMemory(), topics: [{ name: '论点', sourceTurnId: 'turn-1', findingIndexes: [0] }],
    })).toThrow('CONVERSATION_CHECKPOINT_SOURCE_INVALID');
    expect(() => createWith({
      ...emptyMemory(),
      findings: [{ text: '来自第二轮', sourceTurnId: 'turn-2', evidenceIds: ['evidence-2'] }],
      topics: [{ name: '伪造来源', sourceTurnId: 'turn-1', findingIndexes: [0] }],
    })).toThrow('CONVERSATION_CHECKPOINT_SOURCE_INVALID');
  });

  it('rejects serialized memory larger than 20,000 characters', () => {
    expect(() => createWith({ ...emptyMemory(), openQuestions: ['问'.repeat(20_001)] }))
      .toThrow('CONVERSATION_CHECKPOINT_TOO_LARGE');
  });
});

function createWith(memory: ConversationMemoryV1) {
  return ConversationCheckpoint.create({
    id: 'checkpoint-1', conversationId: 'conversation-1', throughTurnId: 'turn-1', memory, now: NOW,
  });
}

function emptyMemory(): ConversationMemoryV1 {
  return { turnSummaries: [], findings: [], preferences: [], topics: [], openQuestions: [], planSteps: [],
    chapterRanges: [], sourceEvidenceRefs: [] };
}

function itemFor(field: string, index: number): unknown {
  if (field === 'turnSummaries') return { turnId: `turn-${index}`, summary: 'summary' };
  if (field === 'findings') return { text: 'finding', sourceTurnId: 'turn-1', evidenceIds: [] };
  if (field === 'preferences') return { value: 'preference', sourceTurnId: 'turn-1', sourceQuote: 'quote' };
  if (field === 'topics') return { name: 'topic', sourceTurnId: 'turn-1', findingIndexes: [] };
  if (field === 'planSteps') return { text: 'step', status: 'pending' };
  if (field === 'chapterRanges') return { sectionIndex: index };
  if (field === 'sourceEvidenceRefs') return { sourceTurnId: 'turn-1', sourceTaskId: 'task-1', sourceEvidenceId: `e-${index}` };
  return 'question';
}
