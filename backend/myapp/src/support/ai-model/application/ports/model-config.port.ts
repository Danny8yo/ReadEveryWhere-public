export interface PublicModelConfig {
  provider: string;
  displayName: string;
  modelId: string;
  hasApiKey: boolean;
  updatedAt: string | null;
}

export interface ModelCredential {
  provider: string;
  modelId: string;
  apiKey: string;
}

export interface DefaultModelConfig {
  provider: string;
  displayName: string;
  modelId: string;
}

export interface ModelConfigPort {
  getPublic(userId: number): PublicModelConfig;
  getCredential(userId: number): ModelCredential | null;
  save(userId: number, input: { apiKey?: string; modelId?: string }): PublicModelConfig;
  remove(userId: number): boolean;
}
