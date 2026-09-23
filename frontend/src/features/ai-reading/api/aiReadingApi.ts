import type { SaveAiModelConfigPayload, CreateReadingConversationPayload, CreateReadingConversationTurnPayload, ReadingConversationMutationResult, RetryReadingConversationTurnPayload } from '../model/aiReading';
import { request } from '../../../services/apiClient';
import type { AiModelConfig, ReadingBudgetConfig, ReadingConversationDetail, ReadingConversationPage, ReadingConversationTurnDetail, ReadingConversationTurnPage, ReadingEventPage, ReadingTaskDetail, TestAiModelConfigResult } from '../model/aiReading';
const BASE_PATH = '/api/v1/ai-reading';
export const aiReadingApi = {
    getModelConfig: (): Promise<AiModelConfig> => request<AiModelConfig>(`${BASE_PATH}/model-config`),
    saveModelConfig: (payload: SaveAiModelConfigPayload): Promise<AiModelConfig> => request<AiModelConfig>(`${BASE_PATH}/model-config`, {
        method: 'PUT',
        body: JSON.stringify(payload),
    }),
    deleteModelConfig: (): Promise<{
        deleted: boolean;
    }> => request<{
        deleted: boolean;
    }>(`${BASE_PATH}/model-config`, { method: 'DELETE' }),
    testModelConfig: (payload: SaveAiModelConfigPayload): Promise<TestAiModelConfigResult> => request<TestAiModelConfigResult>(`${BASE_PATH}/model-config/test`, {
        method: 'POST',
        body: JSON.stringify(payload),
    }),
    getBudgetConfig: (): Promise<ReadingBudgetConfig> => request<ReadingBudgetConfig>(`${BASE_PATH}/budget-config`),
    createConversation: (payload: CreateReadingConversationPayload): Promise<ReadingConversationDetail> => request<ReadingConversationDetail>(`${BASE_PATH}/conversations`, {
        method: 'POST',
        body: JSON.stringify(payload),
    }),
    listConversations: (bookId: number, page = 1, pageSize = 20): Promise<ReadingConversationPage> => request<ReadingConversationPage>(`${BASE_PATH}/conversations`, {
        params: { bookId, page, pageSize },
    }),
    getConversation: (conversationId: string): Promise<ReadingConversationDetail> => request<ReadingConversationDetail>(`${BASE_PATH}/conversations/${encodeURIComponent(conversationId)}`),
    listConversationTurns: (conversationId: string, beforeTurnNumber?: number, pageSize = 20): Promise<ReadingConversationTurnPage> => request<ReadingConversationTurnPage>(`${BASE_PATH}/conversations/${encodeURIComponent(conversationId)}/turns`, { params: {
            ...(beforeTurnNumber !== undefined ? { beforeTurnNumber } : {}),
            pageSize,
        } }),
    createConversationTurn: (conversationId: string, payload: CreateReadingConversationTurnPayload): Promise<ReadingConversationMutationResult> => request<ReadingConversationMutationResult>(`${BASE_PATH}/conversations/${encodeURIComponent(conversationId)}/turns`, { method: 'POST', body: JSON.stringify(payload) }),
    getConversationTurn: (conversationId: string, turnId: string): Promise<ReadingConversationTurnDetail> => request<ReadingConversationTurnDetail>(`${BASE_PATH}/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}`),
    listConversationTurnEvents: (conversationId: string, turnId: string, afterSequence = 0, limit = 100): Promise<ReadingEventPage> => request<ReadingEventPage>(`${BASE_PATH}/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/events`, { params: { afterSequence, limit } }),
    retryConversationTurn: (conversationId: string, turnId: string, payload: RetryReadingConversationTurnPayload): Promise<ReadingConversationMutationResult> => request<ReadingConversationMutationResult>(`${BASE_PATH}/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/retry`, { method: 'POST', body: JSON.stringify(payload) }),
    cancelConversationTurn: (conversationId: string, turnId: string): Promise<ReadingTaskDetail> => request<ReadingTaskDetail>(`${BASE_PATH}/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/cancel`, { method: 'POST' }),
    deleteConversation: (conversationId: string): Promise<{
        deleted: boolean;
    }> => request<{
        deleted: boolean;
    }>(`${BASE_PATH}/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'DELETE',
    }),
};
