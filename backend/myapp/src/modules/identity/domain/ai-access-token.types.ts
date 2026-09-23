export const AI_ACCESS_TOKEN_PREFIX = "rew_ai_";

export type AiAccessScope = "books:read" | "annotations:read";

export interface AiAccessTokenSummary {
  id: string;
  name: string;
  scopes: AiAccessScope[];
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface AiAccessTokenPrincipal {
  tokenId: string;
  userId: number;
  email: string;
  scopes: AiAccessScope[];
}

export interface CreatedAiAccessToken extends AiAccessTokenSummary {
  token: string;
}
