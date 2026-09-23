export const AI_READING_MODEL_CONFIG_PORT = Symbol("AI_READING_MODEL_CONFIG_PORT");

export interface ModelCredential {
  provider: string;
  modelId: string;
  apiKey: string;
}

export interface ModelConfigPort {
  getCredential(userId: number): ModelCredential | null;
}
