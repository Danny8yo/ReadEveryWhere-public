import type {
  ConversationCheckpoint,
  ConversationTurn,
  ReadingConversation,
  ReadingTask,
} from '../../domain';

export type CreateConversationTurnResult =
  | 'created'
  | 'conversation_turn_active'
  | 'service_turn_limit';

export interface ConversationPage {
  items: ReadingConversation[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ConversationTurnPage {
  items: ConversationTurn[];
  hasMore: boolean;
  nextBeforeTurnNumber: number | null;
}

export interface ConversationTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ConversationStorePort {
  createWithTurn(input: {
    conversation: ReadingConversation;
    turn: ConversationTurn;
    task: ReadingTask;
    requestId?: string;
    maxActiveTurns: number;
  }): CreateConversationTurnResult;
  addTurn(input: {
    conversation: ReadingConversation;
    turn: ConversationTurn;
    task: ReadingTask;
    requestId?: string;
    maxActiveTurns: number;
  }): CreateConversationTurnResult;
  findForUser(conversationId: string, userId: number): ReadingConversation | null;
  listForBook(userId: number, bookId: number, page: number, pageSize: number): ConversationPage;
  findTurnForUser(conversationId: string, turnId: string, userId: number): ConversationTurn | null;
  findTurnByTaskId(taskId: string): ConversationTurn | null;
  listTurns(conversationId: string, userId: number, beforeTurnNumber: number | null, pageSize: number): ConversationTurnPage;
  latestCheckpoint(conversationId: string, userId: number): ConversationCheckpoint | null;
  usageForConversation(conversationId: string, userId: number): ConversationTokenUsage;
  appendCheckpoint(checkpoint: ConversationCheckpoint): boolean;
  saveConversation(conversation: ReadingConversation): void;
  syncTurnFromTask(task: ReadingTask): void;
  isConversationTask(taskId: string): boolean;
  deleteForUser(conversationId: string, userId: number): 'deleted' | 'not_found' | 'active';
}
