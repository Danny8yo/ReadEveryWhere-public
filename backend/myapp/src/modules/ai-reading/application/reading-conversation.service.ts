import { randomUUID } from 'node:crypto';
import {
  AiReadingDomainError,
  BookScope,
  ConversationTurn,
  ReadingConversation,
  ReadingTask,
  type BudgetPolicyInput,
  type BudgetTier,
  type ReaderFocusHint,
} from '../domain';
import type { ConversationStorePort, CreateConversationTurnResult } from './ports/conversation-store.port';
import type { BookAnalysisPort } from './ports/book-analysis.port';
import type { EvidenceStorePort } from './ports/evidence-store.port';
import type { ModelConfigPort } from './ports/model-config.port';
import type { ModelRuntimePort } from './ports/model-runtime.port';
import type { ReadingTaskStorePort } from './ports/reading-task-store.port';
import type { ContentRevision, ReadingToolsPort } from './ports/reading-tools.port';
import { buildConversationRetryContext } from './conversation-retry-context';
import { AiReadingApplicationError } from './application-error';

export interface CreateConversationInput {
  bookId: number;
  message: string;
  budgetTier: BudgetTier;
  budgetPolicy?: BudgetPolicyInput;
  readerFocus?: ReaderFocusHint;
}

export interface CreateConversationTurnInput {
  message: string;
  budgetTier: BudgetTier;
  budgetPolicy?: BudgetPolicyInput;
  readerFocus?: ReaderFocusHint;
}

export class ReadingConversationService {
  constructor(
    private readonly modelConfigs: Pick<ModelConfigPort, 'getCredential'>,
    private readonly conversations: ConversationStorePort,
    private readonly readingTools: Pick<ReadingToolsPort, 'inspectOwnedBook' | 'preflight'>,
    private readonly bookAnalysis: BookAnalysisPort,
    private readonly tasks: Pick<ReadingTaskStorePort, 'findForUser'>,
    private readonly evidence: Pick<EvidenceStorePort, 'listForTask'>,
    private readonly options: { maxActiveTurns: number; enabled: boolean },
    private readonly modelRuntime: ModelRuntimePort,
  ) {}

  async createConversation(userId: number, input: CreateConversationInput, requestId?: string) {
    this.assertEnabled();
    this.assertModelConfigured(userId);
    const profileAccess = await this.bookAnalysis.getAccess(userId, input.bookId);
    if (profileAccess.status !== 'ready' || profileAccess.stale || !profileAccess.profile) {
      throw analysisGateError(profileAccess.status);
    }
    const revision = await this.currentRevision(userId, input.bookId);
    await this.readingTools.preflight(revision.scope);
    const profile = {
      ...profileAccess.profile,
      secondaryGenres: [...profileAccess.profile.secondaryGenres],
      traits: [...profileAccess.profile.traits],
      confidence: typeof profileAccess.profile.confidence === 'number'
        ? profileAccess.profile.confidence
        : { ...profileAccess.profile.confidence },
      contentRevision: { ...revision.value },
      spoilerPolicy: 'avoid_unless_user_requests' as const,
    };

    const now = new Date().toISOString();
    const conversation = ReadingConversation.create({
      id: randomUUID(), userId: String(userId), bookId: String(input.bookId),
      contentRevision: revision.serialized, rootGoal: input.message,
      profileSnapshot: profile, now,
    });
    const task = createTask({
      userId, bookId: input.bookId, contentRevision: revision.serialized,
      goal: conversation.rootGoal, budgetTier: input.budgetTier, budgetPolicy: input.budgetPolicy,
      profile: conversation.profileSnapshot, now,
    });
    const turn = ConversationTurn.create({
      id: randomUUID(), conversationId: conversation.id, taskId: task.id,
      turnNumber: 1, userInput: input.message, readerFocus: input.readerFocus, now,
    });
    this.mapCreateResult(this.conversations.createWithTurn({
      conversation, turn, task, requestId, maxActiveTurns: this.options.maxActiveTurns,
    }));
    return { ...toConversation(conversation), turns: [this.toTurn(userId, turn)] };
  }

  async createTurn(
    userId: number, conversationId: string, input: CreateConversationTurnInput, requestId?: string,
  ) {
    this.assertEnabled();
    this.assertModelConfigured(userId);
    const conversation = this.requireConversation(userId, conversationId);
    const revision = await this.currentRevision(userId, Number(conversation.bookId));
    this.assertCurrentRevision(conversation, revision.serialized);
    await this.readingTools.preflight(revision.scope);

    const existingTurns = this.conversations.listTurns(conversation.id, userId, null, 1).items;
    const latest = existingTurns[existingTurns.length - 1];
    const now = new Date().toISOString();
    const task = createTask({
      userId, bookId: Number(conversation.bookId), contentRevision: conversation.contentRevision,
      goal: input.message, budgetTier: input.budgetTier, budgetPolicy: input.budgetPolicy,
      profile: conversation.profileSnapshot, now,
    });
    const turn = ConversationTurn.create({
      id: randomUUID(), conversationId, taskId: task.id,
      turnNumber: (latest?.turnNumber ?? 0) + 1, userInput: input.message,
      readerFocus: input.readerFocus, now,
    });
    this.mapCreateResult(this.conversations.addTurn({
      conversation, turn, task, requestId, maxActiveTurns: this.options.maxActiveTurns,
    }));
    return { conversation: toConversation(conversation), turn: this.toTurn(userId, turn) };
  }

  async retryTurn(
    userId: number, conversationId: string, turnId: string,
    input: { message?: string; budgetTier?: BudgetTier; budgetPolicy?: BudgetPolicyInput },
    requestId?: string,
  ) {
    this.assertEnabled();
    this.assertModelConfigured(userId);
    const conversation = this.requireConversation(userId, conversationId);
    const source = this.conversations.findTurnForUser(conversationId, turnId, userId);
    if (!source) throw notFound('turnId', 'Conversation turn not found');
    if (source.status !== 'failed' && source.status !== 'cancelled') {
      throw conflict('turnId', 'TURN_NOT_RETRYABLE', 'Only failed or cancelled turns can be retried');
    }
    const revision = await this.currentRevision(userId, Number(conversation.bookId));
    this.assertCurrentRevision(conversation, revision.serialized);
    await this.readingTools.preflight(revision.scope);
    const existingTurns = this.conversations.listTurns(conversation.id, userId, null, 1).items;
    const latest = existingTurns[existingTurns.length - 1];
    const now = new Date().toISOString();
    const tier = input.budgetTier ?? 'standard';
    const retryMessage = input.message ?? source.userInput;
    const task = createTask({
      userId, bookId: Number(conversation.bookId), contentRevision: conversation.contentRevision,
      goal: retryMessage, budgetTier: tier, budgetPolicy: input.budgetPolicy,
      profile: conversation.profileSnapshot, now,
    });
    const turn = ConversationTurn.createRetry({
      source, id: randomUUID(), taskId: task.id, turnNumber: (latest?.turnNumber ?? 0) + 1,
      userInput: retryMessage, now,
    });
    this.mapCreateResult(this.conversations.addTurn({
      conversation, turn, task, requestId, maxActiveTurns: this.options.maxActiveTurns,
    }));
    return { conversation: toConversation(conversation), turn: this.toTurn(userId, turn) };
  }

  listConversations(userId: number, bookId: number, page: number, pageSize: number) {
    this.assertEnabled();
    const result = this.conversations.listForBook(userId, bookId, page, pageSize);
    return { ...result, items: result.items.map((conversation) => ({
      ...toConversation(conversation),
      usage: this.conversations.usageForConversation(conversation.id, userId),
    })) };
  }

  getConversation(userId: number, conversationId: string) {
    this.assertEnabled();
    const conversation = this.requireConversation(userId, conversationId);
    const turns = this.conversations.listTurns(conversationId, userId, null, 20);
    return {
      ...toConversation(conversation),
      usage: this.conversations.usageForConversation(conversationId, userId),
      turns: turns.items.map((turn) => this.toTurn(userId, turn)), hasMoreTurns: turns.hasMore,
    };
  }

  listTurns(userId: number, conversationId: string, beforeTurnNumber: number | null, pageSize: number) {
    this.assertEnabled();
    this.requireConversation(userId, conversationId);
    const result = this.conversations.listTurns(conversationId, userId, beforeTurnNumber, pageSize);
    return { ...result, items: result.items.map((turn) => this.toTurn(userId, turn)) };
  }

  getTurn(userId: number, conversationId: string, turnId: string) {
    this.assertEnabled();
    this.requireConversation(userId, conversationId);
    const turn = this.conversations.findTurnForUser(conversationId, turnId, userId);
    if (!turn) throw notFound('turnId', 'Conversation turn not found');
    return this.toTurn(userId, turn);
  }

  deleteConversation(userId: number, conversationId: string) {
    this.assertEnabled();
    const result = this.conversations.deleteForUser(conversationId, userId);
    if (result === 'not_found') throw notFound('conversationId', 'Conversation not found');
    if (result === 'active') {
      throw conflict('conversationId', 'CONVERSATION_TURN_ACTIVE', 'Cancel the active turn before deleting the conversation');
    }
    return { deleted: true };
  }

  private requireConversation(userId: number, conversationId: string): ReadingConversation {
    const value = this.conversations.findForUser(conversationId, userId);
    if (!value) throw notFound('conversationId', 'Conversation not found');
    return value;
  }

  private assertCurrentRevision(conversation: ReadingConversation, serialized: string): void {
    if (conversation.status === 'frozen') {
      throw conflict('conversationId', 'CONVERSATION_FROZEN', 'Conversation is frozen');
    }
    if (serialized !== conversation.contentRevision) {
      conversation.freezeForRevision(serialized, new Date().toISOString());
      this.conversations.saveConversation(conversation);
      throw conflict(
        'conversationId', 'CONVERSATION_REVISION_CHANGED',
        'Book content changed; create a conversation for the current revision',
      );
    }
  }

  private async currentRevision(userId: number, bookId: number) {
    const metadata = await this.readingTools.inspectOwnedBook(userId, bookId);
    const value = (metadata as { contentRevision?: unknown }).contentRevision;
    if (!isContentRevision(value)) {
      throw new AiReadingApplicationError('invalid_state', 'Book metadata has no content revision', {
        field: 'bookId',
        reason: 'INVALID_STATE',
      });
    }
    const serialized = JSON.stringify(value);
    return {
      value,
      serialized,
      scope: BookScope.create({ userId: String(userId), bookId: String(bookId), contentRevision: serialized }),
    };
  }

  private assertModelConfigured(userId: number): void {
    const credential = this.modelConfigs.getCredential(userId);
    if (!credential) {
      throw new AiReadingApplicationError(
        'validation',
        'Configure a DeepSeek API key before starting an AI reading turn',
        { field: 'apiKey', reason: 'VALIDATION_ERROR' },
      );
    }
    try {
      this.modelRuntime.assertCapability(credential.provider, credential.modelId ?? '', 'strictTools');
    } catch {
      throw new AiReadingApplicationError(
        'unsupported_model',
        'Reasoning models are not supported by tool-based AI reading', {
        field: 'modelId', reason: 'DEEPSEEK_MODEL_UNSUPPORTED',
        },
      );
    }
  }

  private assertEnabled(): void {
    if (!this.options.enabled) {
      throw new AiReadingApplicationError('disabled', 'Conversation API is disabled', {
        field: 'conversation', reason: 'CONVERSATIONS_DISABLED',
      });
    }
  }

  private mapCreateResult(result: CreateConversationTurnResult): void {
    if (result === 'created') return;
    if (result === 'conversation_turn_active') {
      throw conflict('conversationId', 'CONVERSATION_TURN_ACTIVE', 'Only one turn can be active in a conversation');
    }
    throw conflict('turn', 'AI_READING_TURN_CAPACITY', 'The service already has two active reading turns');
  }

  private toTurn(userId: number, value: ConversationTurn) {
    const json = value.toJSON();
    const retrySource = json.retryOfTurnId
      ? this.retrySource(userId, value.conversationId, json.retryOfTurnId)
      : null;
    return {
      id: json.id, conversationId: json.conversationId, taskId: json.taskId,
      turnNumber: json.turnNumber, userInput: json.userInput, status: json.status,
      retryOfTurnId: json.retryOfTurnId ?? null, retrySource,
      readerFocus: json.readerFocus ?? null,
      clarificationQuestion: json.clarificationQuestion ?? null,
      createdAt: json.createdAt, updatedAt: json.updatedAt, finishedAt: json.finishedAt ?? null,
    };
  }

  private retrySource(userId: number, conversationId: string, sourceTurnId: string) {
    const source = this.conversations.findTurnForUser(conversationId, sourceTurnId, userId);
    if (!source || (source.status !== 'failed' && source.status !== 'cancelled')) return null;
    const task = this.tasks.findForUser(source.taskId, userId);
    if (!task) return null;
    return buildConversationRetryContext({
      sourceTurnId: source.id,
      sourceStatus: source.status,
      terminalReason: task.toJSON().terminalReason,
      bookId: task.scope.bookId,
      contentRevision: task.scope.contentRevision,
      evidence: this.evidence.listForTask(source.taskId),
    });
  }
}

function createTask(input: {
  userId: number; bookId: number; contentRevision: string; goal: string; budgetTier: BudgetTier;
  budgetPolicy?: BudgetPolicyInput; profile: ReadingConversation['profileSnapshot']; now: string;
}) {
  try {
    return ReadingTask.create({
      id: randomUUID(), userId: String(input.userId), goal: input.goal,
      scope: BookScope.create({
        userId: String(input.userId), bookId: String(input.bookId), contentRevision: input.contentRevision,
      }),
      budgetTier: input.budgetTier, budgetPolicy: input.budgetPolicy,
      bookAnalysis: input.profile, now: input.now,
    });
  } catch (error) {
    if (error instanceof AiReadingDomainError && error.code === 'BUDGET_POLICY_INVALID') {
      throw new AiReadingApplicationError('validation', error.message, {
        field: 'budgetPolicy',
        reason: 'VALIDATION_ERROR',
      });
    }
    throw error;
  }
}

function toConversation(value: ReadingConversation) {
  const json = value.toJSON();
  return {
    id: json.id, bookId: Number(json.bookId), rootGoal: json.rootGoal,
    contentRevision: JSON.parse(json.contentRevision), status: json.status,
    profileId: json.profileSnapshot.profileId,
    profileVersion: json.profileSnapshot.profileVersion ?? null,
    strategyVersion: json.profileSnapshot.strategyVersion ?? null,
    createdAt: json.createdAt, updatedAt: json.updatedAt,
    frozenAt: json.frozenAt ?? null, frozenReason: json.frozenReason ?? null,
  };
}

function notFound(field: string, message: string): AiReadingApplicationError {
  return new AiReadingApplicationError('not_found', message, {
    field,
    reason: 'RESOURCE_NOT_FOUND',
  });
}

function conflict(field: string, reason: string, message: string): AiReadingApplicationError {
  return new AiReadingApplicationError('conflict', message, { field, reason });
}

function analysisGateError(status: string): AiReadingApplicationError {
  const reason = status === 'pending' || status === 'running'
    ? 'BOOK_ANALYSIS_IN_PROGRESS'
    : status === 'failed'
      ? 'BOOK_ANALYSIS_FAILED'
      : status === 'unsupported'
        ? 'BOOK_ANALYSIS_UNSUPPORTED'
        : 'BOOK_ANALYSIS_REQUIRED';
  return new AiReadingApplicationError('conflict', 'A current book analysis is required', {
    field: 'bookAnalysis', reason,
  });
}

function isContentRevision(value: unknown): value is ContentRevision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const revision = value as Record<string, unknown>;
  return typeof revision.fileChecksum === 'string' && revision.fileChecksum.length > 0
    && typeof revision.extractorVersion === 'string' && revision.extractorVersion.length > 0
    && typeof revision.normalizationVersion === 'string' && revision.normalizationVersion.length > 0;
}
