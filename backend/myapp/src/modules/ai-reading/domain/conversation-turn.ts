import {
  AiReadingDomainError,
  jsonClone,
  requireIsoDate,
  requireNonEmpty,
} from './domain-error';

export type ConversationTurnStatus =
  | 'queued' | 'running' | 'completed' | 'partial' | 'needs_input' | 'failed' | 'cancelled';

export interface ReaderFocusHint {
  sectionIndex: number;
  chapterLabel?: string;
}

export interface ConversationTurnJSON {
  id: string;
  conversationId: string;
  taskId: string;
  turnNumber: number;
  userInput: string;
  status: ConversationTurnStatus;
  retryOfTurnId?: string;
  readerFocus?: ReaderFocusHint;
  clarificationQuestion?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

const TERMINAL: ReadonlySet<ConversationTurnStatus> = new Set([
  'completed', 'partial', 'needs_input', 'failed', 'cancelled',
]);

export class ConversationTurn {
  private statusValue: ConversationTurnStatus;
  private updatedAtValue: string;
  private finishedAtValue?: string;
  private clarificationQuestionValue?: string;

  private constructor(
    public readonly id: string,
    public readonly conversationId: string,
    public readonly taskId: string,
    public readonly turnNumber: number,
    public readonly userInput: string,
    public readonly retryOfTurnId: string | undefined,
    public readonly readerFocus: ReaderFocusHint | undefined,
    public readonly createdAt: string,
    status: ConversationTurnStatus,
    updatedAt: string,
    finishedAt?: string,
    clarificationQuestion?: string,
  ) {
    this.statusValue = status;
    this.updatedAtValue = updatedAt;
    this.finishedAtValue = finishedAt;
    this.clarificationQuestionValue = clarificationQuestion;
  }

  static create(input: {
    id: string; conversationId: string; taskId: string; turnNumber: number; userInput: string;
    retryOfTurnId?: string; readerFocus?: ReaderFocusHint; now: string;
  }): ConversationTurn {
    validate(input, 'CONVERSATION_TURN_INVALID');
    return new ConversationTurn(
      input.id.trim(), input.conversationId.trim(), input.taskId.trim(), input.turnNumber,
      input.userInput.trim(), input.retryOfTurnId?.trim(), cloneFocus(input.readerFocus),
      input.now, 'queued', input.now,
    );
  }

  static createRetry(input: {
    source: ConversationTurn; id: string; taskId: string; turnNumber: number; now: string; userInput?: string;
  }): ConversationTurn {
    if (input.source.status !== 'failed' && input.source.status !== 'cancelled') {
      throw new AiReadingDomainError('TURN_NOT_RETRYABLE', 'only failed or cancelled turns can be retried');
    }
    if (input.taskId === input.source.taskId) {
      throw new AiReadingDomainError('TURN_RETRY_TASK_REUSED', 'retry must create a new reading task');
    }
    return ConversationTurn.create({
      id: input.id, conversationId: input.source.conversationId, taskId: input.taskId,
      turnNumber: input.turnNumber, userInput: input.userInput ?? input.source.userInput,
      retryOfTurnId: input.source.id, readerFocus: input.source.readerFocus, now: input.now,
    });
  }

  static fromJSON(value: ConversationTurnJSON): ConversationTurn {
    validate({ ...value, now: value.createdAt }, 'CONVERSATION_TURN_STATE_INVALID');
    requireIsoDate(value.updatedAt, 'CONVERSATION_TURN_STATE_INVALID', 'updatedAt');
    if (![...TERMINAL, 'queued', 'running'].includes(value.status)) {
      throw new AiReadingDomainError('CONVERSATION_TURN_STATE_INVALID', 'turn status is invalid');
    }
    if (TERMINAL.has(value.status)) {
      if (!value.finishedAt) throw new AiReadingDomainError('CONVERSATION_TURN_STATE_INVALID', 'terminal turn requires finishedAt');
      requireIsoDate(value.finishedAt, 'CONVERSATION_TURN_STATE_INVALID', 'finishedAt');
    }
    if (value.status === 'needs_input') requireNonEmpty(
      value.clarificationQuestion ?? '', 'CONVERSATION_TURN_STATE_INVALID', 'clarificationQuestion',
    );
    return new ConversationTurn(
      value.id, value.conversationId, value.taskId, value.turnNumber, value.userInput,
      value.retryOfTurnId, cloneFocus(value.readerFocus), value.createdAt, value.status,
      value.updatedAt, value.finishedAt, value.clarificationQuestion,
    );
  }

  get status(): ConversationTurnStatus { return this.statusValue; }
  get isActive(): boolean { return this.statusValue === 'queued' || this.statusValue === 'running'; }

  start(now: string): void { this.transition('queued', 'running', now); }

  complete(status: Exclude<ConversationTurnStatus, 'queued' | 'running' | 'needs_input'>, now: string): void {
    if (status === 'completed' || status === 'partial') {
      this.transition('running', status, now);
      return;
    }
    if (!this.isActive) this.invalidTransition(status);
    requireIsoDate(now, 'CONVERSATION_TURN_INVALID', 'now');
    this.finish(status, now);
  }

  requestInput(question: string, now: string): void {
    requireNonEmpty(question, 'CONVERSATION_TURN_INVALID', 'question');
    this.transition('running', 'needs_input', now);
    this.clarificationQuestionValue = question.trim();
  }

  toJSON(): ConversationTurnJSON {
    return {
      id: this.id, conversationId: this.conversationId, taskId: this.taskId, turnNumber: this.turnNumber,
      userInput: this.userInput, status: this.statusValue, retryOfTurnId: this.retryOfTurnId,
      readerFocus: cloneFocus(this.readerFocus), clarificationQuestion: this.clarificationQuestionValue,
      createdAt: this.createdAt, updatedAt: this.updatedAtValue, finishedAt: this.finishedAtValue,
    };
  }

  private transition(expected: ConversationTurnStatus, next: ConversationTurnStatus, now: string): void {
    if (this.statusValue !== expected || TERMINAL.has(this.statusValue)) this.invalidTransition(next);
    requireIsoDate(now, 'CONVERSATION_TURN_INVALID', 'now');
    this.statusValue = next;
    this.updatedAtValue = now;
    if (TERMINAL.has(next)) this.finishedAtValue = now;
  }

  private finish(status: ConversationTurnStatus, now: string): void {
    this.statusValue = status;
    this.updatedAtValue = now;
    this.finishedAtValue = now;
  }

  private invalidTransition(next: ConversationTurnStatus): never {
    throw new AiReadingDomainError('TURN_TRANSITION_INVALID', `cannot transition turn from ${this.statusValue} to ${next}`);
  }
}

function validate(input: {
  id: string; conversationId: string; taskId: string; turnNumber: number; userInput: string;
  retryOfTurnId?: string; readerFocus?: ReaderFocusHint; now: string;
}, code: string): void {
  for (const field of ['id', 'conversationId', 'taskId', 'userInput'] as const) requireNonEmpty(input[field], code, field);
  requireIsoDate(input.now, code, 'now');
  if (!Number.isInteger(input.turnNumber) || input.turnNumber < 1) throw new AiReadingDomainError(code, 'turnNumber must be positive');
  if (input.retryOfTurnId !== undefined) requireNonEmpty(input.retryOfTurnId, code, 'retryOfTurnId');
  if (input.readerFocus && (!Number.isInteger(input.readerFocus.sectionIndex) || input.readerFocus.sectionIndex < 0)) {
    throw new AiReadingDomainError(code, 'readerFocus.sectionIndex must be a non-negative integer');
  }
}

function cloneFocus(value: ReaderFocusHint | undefined): ReaderFocusHint | undefined {
  return value ? jsonClone(value, 'CONVERSATION_TURN_INVALID') : undefined;
}
