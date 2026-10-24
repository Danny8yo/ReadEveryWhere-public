export interface AiModelConfig {
    provider: 'deepseek';
    displayName: 'DeepSeek-V4-flash' | string;
    modelId: string;
    hasApiKey: boolean;
    updatedAt: string | null;
}
export interface TestAiModelConfigResult {
    ok: boolean;
    modelId: string;
    latencyMs: number;
    errorCode?: string;
}
export interface SaveAiModelConfigPayload {
    apiKey?: string;
    modelId?: string;
}
