import type { TrustedBookAnalysisContext } from './reading-task';
import {
  AiReadingDomainError,
  jsonClone,
  requireIsoDate,
  requireNonEmpty,
} from './domain-error';

export type ReadingConversationStatus = 'active' | 'frozen';
export type ReadingConversationFrozenReason = 'content_revision_changed';

export interface ReadingConversationJSON {
  id: string;
  userId: string;
  bookId: string;
  contentRevision: string;
  rootGoal: string;
  status: ReadingConversationStatus;
  profileSnapshot: TrustedBookAnalysisContext;
  createdAt: string;
  updatedAt: string;
  frozenAt?: string;
  frozenReason?: ReadingConversationFrozenReason;
}

export class ReadingConversation {
  private statusValue: ReadingConversationStatus;
  private updatedAtValue: string;
  private frozenAtValue?: string;
  private frozenReasonValue?: ReadingConversationFrozenReason;

  private constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly bookId: string,
    public readonly contentRevision: string,
    public readonly rootGoal: string,
    public readonly profileSnapshot: TrustedBookAnalysisContext,
    public readonly createdAt: string,
    status: ReadingConversationStatus,
    updatedAt: string,
    frozenAt?: string,
    frozenReason?: ReadingConversationFrozenReason,
  ) {
    this.statusValue = status;
    this.updatedAtValue = updatedAt;
    this.frozenAtValue = frozenAt;
    this.frozenReasonValue = frozenReason;
  }

  static create(input: {
    id: string;
    userId: string;
    bookId: string;
    contentRevision: string;
    rootGoal: string;
    profileSnapshot: TrustedBookAnalysisContext;
    now: string;
  }): ReadingConversation {
    validateIdentity(input, 'READING_CONVERSATION_INVALID');
    return new ReadingConversation(
      input.id.trim(), input.userId.trim(), input.bookId.trim(), input.contentRevision.trim(),
      input.rootGoal.trim(), cloneProfile(input.profileSnapshot), input.now, 'active', input.now,
    );
  }

  static fromJSON(value: ReadingConversationJSON): ReadingConversation {
    validateIdentity(value, 'READING_CONVERSATION_STATE_INVALID');
    requireIsoDate(value.updatedAt, 'READING_CONVERSATION_STATE_INVALID', 'updatedAt');
    if (value.status !== 'active' && value.status !== 'frozen') {
      throw new AiReadingDomainError('READING_CONVERSATION_STATE_INVALID', 'conversation status is invalid');
    }
    if (value.status === 'frozen') {
      if (value.frozenReason !== 'content_revision_changed' || !value.frozenAt) {
        throw new AiReadingDomainError('READING_CONVERSATION_STATE_INVALID', 'frozen conversation requires reason and time');
      }
      requireIsoDate(value.frozenAt, 'READING_CONVERSATION_STATE_INVALID', 'frozenAt');
    } else if (value.frozenAt || value.frozenReason) {
      throw new AiReadingDomainError('READING_CONVERSATION_STATE_INVALID', 'active conversation cannot have frozen fields');
    }
    return new ReadingConversation(
      value.id, value.userId, value.bookId, value.contentRevision, value.rootGoal,
      cloneProfile(value.profileSnapshot), value.createdAt, value.status, value.updatedAt,
      value.frozenAt, value.frozenReason,
    );
  }

  get status(): ReadingConversationStatus { return this.statusValue; }

  assertOwnedBy(userId: string): void {
    if (this.userId !== userId) {
      throw new AiReadingDomainError('CONVERSATION_NOT_FOUND', 'conversation was not found');
    }
  }

  assertBook(bookId: string): void {
    if (this.bookId !== bookId) {
      throw new AiReadingDomainError('CONVERSATION_BOOK_MISMATCH', 'conversation belongs to another book');
    }
  }

  assertCanCreateTurn(currentRevision: string): void {
    if (this.statusValue === 'frozen') {
      throw new AiReadingDomainError('CONVERSATION_FROZEN', 'frozen conversation cannot accept new turns');
    }
    if (currentRevision !== this.contentRevision) {
      this.freezeForRevision(currentRevision, new Date().toISOString());
      throw new AiReadingDomainError(
        'CONVERSATION_REVISION_CHANGED',
        'book content changed; create a new conversation for the current revision',
      );
    }
  }

  freezeForRevision(currentRevision: string, now: string): boolean {
    requireNonEmpty(currentRevision, 'READING_CONVERSATION_INVALID', 'currentRevision');
    requireIsoDate(now, 'READING_CONVERSATION_INVALID', 'now');
    if (this.statusValue === 'frozen') {
      throw new AiReadingDomainError('CONVERSATION_FROZEN', 'frozen conversation cannot be reopened');
    }
    if (currentRevision === this.contentRevision) return false;
    this.statusValue = 'frozen';
    this.updatedAtValue = now;
    this.frozenAtValue = now;
    this.frozenReasonValue = 'content_revision_changed';
    return true;
  }

  toJSON(): ReadingConversationJSON {
    return {
      id: this.id, userId: this.userId, bookId: this.bookId,
      contentRevision: this.contentRevision, rootGoal: this.rootGoal,
      status: this.statusValue, profileSnapshot: cloneProfile(this.profileSnapshot),
      createdAt: this.createdAt, updatedAt: this.updatedAtValue,
      frozenAt: this.frozenAtValue, frozenReason: this.frozenReasonValue,
    };
  }
}

function validateIdentity(input: {
  id: string; userId: string; bookId: string; contentRevision: string; rootGoal: string;
  profileSnapshot: TrustedBookAnalysisContext; createdAt?: string; now?: string;
}, code: string): void {
  for (const field of ['id', 'userId', 'bookId', 'contentRevision', 'rootGoal'] as const) {
    requireNonEmpty(input[field], code, field);
  }
  requireIsoDate(input.createdAt ?? input.now ?? '', code, input.createdAt ? 'createdAt' : 'now');
  if (!input.profileSnapshot || input.profileSnapshot.profileId.trim().length === 0) {
    throw new AiReadingDomainError(code, 'profile snapshot is required');
  }
}

function cloneProfile(value: TrustedBookAnalysisContext): TrustedBookAnalysisContext {
  return jsonClone(value, 'READING_CONVERSATION_INVALID');
}
