import {
  AiReadingDomainError,
  jsonClone,
  requireIsoDate,
  requireNonEmpty,
} from './domain-error';

export interface ConversationMemoryV1 {
  turnSummaries: Array<{ turnId: string; summary: string }>;
  findings: Array<{ text: string; sourceTurnId: string; evidenceIds: string[] }>;
  preferences: Array<{ value: string; sourceTurnId: string; sourceQuote: string }>;
  topics: Array<{ name: string; sourceTurnId: string; findingIndexes: number[] }>;
  openQuestions: string[];
  planSteps: Array<{ text: string; status: 'pending' | 'completed' }>;
  chapterRanges: Array<{ sectionIndex: number; chapterLabel?: string; startLocator?: unknown; endLocator?: unknown }>;
  sourceEvidenceRefs: Array<{ sourceTurnId: string; sourceTaskId: string; sourceEvidenceId: string }>;
}

export interface ConversationCheckpointJSON {
  id: string;
  conversationId: string;
  throughTurnId: string;
  schemaVersion: 1;
  memory: ConversationMemoryV1;
  sourceRefs: ConversationMemoryV1['sourceEvidenceRefs'];
  characterCount: number;
  createdAt: string;
}

const LIMITS: Record<keyof ConversationMemoryV1, number> = {
  turnSummaries: 6, findings: 20, preferences: 10, topics: 20,
  openQuestions: 10, planSteps: 20, chapterRanges: 6, sourceEvidenceRefs: 48,
};

export class ConversationCheckpoint {
  static readonly MAX_CHARACTERS = 20_000;

  private constructor(
    public readonly id: string,
    public readonly conversationId: string,
    public readonly throughTurnId: string,
    private readonly memoryValue: ConversationMemoryV1,
    public readonly characterCount: number,
    public readonly createdAt: string,
  ) {}

  static create(input: {
    id: string; conversationId: string; throughTurnId: string; memory: ConversationMemoryV1; now: string;
  }): ConversationCheckpoint {
    validateIdentity(input, 'CONVERSATION_CHECKPOINT_INVALID');
    const memory = validateMemory(input.memory);
    const characterCount = JSON.stringify(memory).length;
    if (characterCount > ConversationCheckpoint.MAX_CHARACTERS) {
      throw new AiReadingDomainError('CONVERSATION_CHECKPOINT_TOO_LARGE', 'checkpoint exceeds 20,000 characters');
    }
    return new ConversationCheckpoint(
      input.id.trim(), input.conversationId.trim(), input.throughTurnId.trim(), memory, characterCount, input.now,
    );
  }

  static fromJSON(value: ConversationCheckpointJSON): ConversationCheckpoint {
    if (value.schemaVersion !== 1) throw new AiReadingDomainError('CONVERSATION_CHECKPOINT_STATE_INVALID', 'unsupported schema version');
    const checkpoint = ConversationCheckpoint.create({
      id: value.id, conversationId: value.conversationId, throughTurnId: value.throughTurnId,
      memory: value.memory, now: value.createdAt,
    });
    if (checkpoint.characterCount !== value.characterCount
      || JSON.stringify(value.sourceRefs) !== JSON.stringify(checkpoint.memory.sourceEvidenceRefs)) {
      throw new AiReadingDomainError('CONVERSATION_CHECKPOINT_STATE_INVALID', 'checkpoint projection is inconsistent');
    }
    return checkpoint;
  }

  get memory(): ConversationMemoryV1 {
    return jsonClone(this.memoryValue, 'CONVERSATION_CHECKPOINT_STATE_INVALID');
  }

  toJSON(): ConversationCheckpointJSON {
    const memory = this.memory;
    return {
      id: this.id, conversationId: this.conversationId, throughTurnId: this.throughTurnId,
      schemaVersion: 1, memory, sourceRefs: memory.sourceEvidenceRefs,
      characterCount: this.characterCount, createdAt: this.createdAt,
    };
  }
}

function validateIdentity(input: { id: string; conversationId: string; throughTurnId: string; now: string }, code: string): void {
  for (const field of ['id', 'conversationId', 'throughTurnId'] as const) requireNonEmpty(input[field], code, field);
  requireIsoDate(input.now, code, 'now');
}

function validateMemory(value: ConversationMemoryV1): ConversationMemoryV1 {
  if (!value || typeof value !== 'object') throw new AiReadingDomainError('CONVERSATION_CHECKPOINT_INVALID', 'memory must be an object');
  for (const [field, limit] of Object.entries(LIMITS) as Array<[keyof ConversationMemoryV1, number]>) {
    if (!Array.isArray(value[field])) throw new AiReadingDomainError('CONVERSATION_CHECKPOINT_INVALID', `${field} must be an array`);
    if (value[field].length > limit) throw new AiReadingDomainError(
      'CONVERSATION_CHECKPOINT_LIMIT_EXCEEDED', `${field} exceeds its item limit`, { field, limit },
    );
  }
  const memory = jsonClone(value, 'CONVERSATION_CHECKPOINT_INVALID');
  memory.turnSummaries.forEach((item) => {
    requireNonEmpty(item.turnId, 'CONVERSATION_CHECKPOINT_SOURCE_INVALID', 'turnSummary.turnId');
    requireNonEmpty(item.summary, 'CONVERSATION_CHECKPOINT_SOURCE_INVALID', 'turnSummary.summary');
  });
  memory.findings.forEach((item) => {
    requireNonEmpty(item.text, 'CONVERSATION_CHECKPOINT_SOURCE_INVALID', 'finding.text');
    requireNonEmpty(item.sourceTurnId, 'CONVERSATION_CHECKPOINT_SOURCE_INVALID', 'finding.sourceTurnId');
    if (!Array.isArray(item.evidenceIds)) throw new AiReadingDomainError('CONVERSATION_CHECKPOINT_SOURCE_INVALID', 'finding evidenceIds must be an array');
  });
  memory.preferences.forEach((item) => {
    requireNonEmpty(item.value, 'CONVERSATION_CHECKPOINT_SOURCE_INVALID', 'preference.value');
    requireNonEmpty(item.sourceTurnId, 'CONVERSATION_CHECKPOINT_SOURCE_INVALID', 'preference.sourceTurnId');
    requireNonEmpty(item.sourceQuote, 'CONVERSATION_CHECKPOINT_SOURCE_INVALID', 'preference.sourceQuote');
  });
  memory.topics.forEach((item) => {
    requireNonEmpty(item.name, 'CONVERSATION_CHECKPOINT_SOURCE_INVALID', 'topic.name');
    requireNonEmpty(item.sourceTurnId, 'CONVERSATION_CHECKPOINT_SOURCE_INVALID', 'topic.sourceTurnId');
    if (!Array.isArray(item.findingIndexes) || item.findingIndexes.length === 0 || item.findingIndexes.some((index) => (
      !Number.isInteger(index) || index < 0 || index >= memory.findings.length
      || memory.findings[index].sourceTurnId !== item.sourceTurnId
    ))) throw new AiReadingDomainError(
      'CONVERSATION_CHECKPOINT_SOURCE_INVALID',
      'topic must reference findings from its source turn',
    );
  });
  memory.openQuestions.forEach((item) => requireNonEmpty(item, 'CONVERSATION_CHECKPOINT_SOURCE_INVALID', 'openQuestion'));
  memory.planSteps.forEach((item) => {
    requireNonEmpty(item.text, 'CONVERSATION_CHECKPOINT_SOURCE_INVALID', 'planStep.text');
    if (item.status !== 'pending' && item.status !== 'completed') throw new AiReadingDomainError('CONVERSATION_CHECKPOINT_SOURCE_INVALID', 'plan step status is invalid');
  });
  memory.chapterRanges.forEach((item) => {
    if (!Number.isInteger(item.sectionIndex) || item.sectionIndex < 0) throw new AiReadingDomainError('CONVERSATION_CHECKPOINT_SOURCE_INVALID', 'chapter range sectionIndex is invalid');
  });
  memory.sourceEvidenceRefs.forEach((item) => {
    requireNonEmpty(item.sourceTurnId, 'CONVERSATION_CHECKPOINT_SOURCE_INVALID', 'sourceEvidenceRef.sourceTurnId');
    requireNonEmpty(item.sourceTaskId, 'CONVERSATION_CHECKPOINT_SOURCE_INVALID', 'sourceEvidenceRef.sourceTaskId');
    requireNonEmpty(item.sourceEvidenceId, 'CONVERSATION_CHECKPOINT_SOURCE_INVALID', 'sourceEvidenceRef.sourceEvidenceId');
  });
  return memory;
}
