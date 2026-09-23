import type { SaveAiModelConfigPayload, CreateReadingConversationPayload, CreateReadingConversationTurnPayload, ReadingConversationMutationResult, RetryReadingConversationTurnPayload } from '../model/aiReading';
import type { AiModelConfig, ReadingBudgetConfig, ReadingConversationDetail, ReadingConversationPage, ReadingConversationTurnDetail, ReadingConversationTurnPage, ReadingEventPage, ReadingTaskDetail, TestAiModelConfigResult } from '../model/aiReading';
export interface ReadingConversationGateway {
    getModelConfig(): Promise<AiModelConfig>;
    saveModelConfig(payload: SaveAiModelConfigPayload): Promise<AiModelConfig>;
    deleteModelConfig(): Promise<{
        deleted: boolean;
    }>;
    testModelConfig(payload: SaveAiModelConfigPayload): Promise<TestAiModelConfigResult>;
    getBudgetConfig(): Promise<ReadingBudgetConfig>;
    createConversation(payload: CreateReadingConversationPayload): Promise<ReadingConversationDetail>;
    listConversations(bookId: number, page?: number, pageSize?: number): Promise<ReadingConversationPage>;
    getConversation(conversationId: string): Promise<ReadingConversationDetail>;
    listConversationTurns(conversationId: string, beforeTurnNumber?: number, pageSize?: number): Promise<ReadingConversationTurnPage>;
    createConversationTurn(conversationId: string, payload: CreateReadingConversationTurnPayload): Promise<ReadingConversationMutationResult>;
    getConversationTurn(conversationId: string, turnId: string): Promise<ReadingConversationTurnDetail>;
    listConversationTurnEvents(conversationId: string, turnId: string, afterSequence?: number, limit?: number): Promise<ReadingEventPage>;
    retryConversationTurn(conversationId: string, turnId: string, payload: RetryReadingConversationTurnPayload): Promise<ReadingConversationMutationResult>;
    cancelConversationTurn(conversationId: string, turnId: string): Promise<ReadingTaskDetail>;
    deleteConversation(conversationId: string): Promise<{
        deleted: boolean;
    }>;
}
