import type { AiModelConfig, TestAiModelConfigResult, SaveAiModelConfigPayload } from '../model/aiModel';

export interface AiModelGateway {
  getModelConfig(): Promise<AiModelConfig>;
  saveModelConfig(payload: SaveAiModelConfigPayload): Promise<AiModelConfig>;
  deleteModelConfig(): Promise<{ deleted: boolean }>;
  testModelConfig(payload: SaveAiModelConfigPayload): Promise<TestAiModelConfigResult>;
}
