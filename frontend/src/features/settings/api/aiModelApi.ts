import type { AiModelConfig, TestAiModelConfigResult, SaveAiModelConfigPayload } from '../model/aiModel';
import { request } from '../../../shared/web/apiClient';
const BASE_PATH = '/api/v1/ai-reading';
export const aiModelApi = {
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
};
