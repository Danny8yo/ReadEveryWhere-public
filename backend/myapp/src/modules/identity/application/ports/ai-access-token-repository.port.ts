import type {
  AiAccessScope,
  AiAccessTokenPrincipal,
  AiAccessTokenSummary,
  CreatedAiAccessToken,
} from "../../domain/ai-access-token.types";

export interface AiAccessTokenRepositoryPort {
  create(
    userId: number,
    name: string,
    scopes: AiAccessScope[],
    expiresAt: Date,
  ): CreatedAiAccessToken;
  verify(token: string): AiAccessTokenPrincipal | null;
  listByUser(userId: number): AiAccessTokenSummary[];
  revoke(userId: number, tokenId: string): boolean;
}

export const AI_ACCESS_TOKEN_REPOSITORY_PORT = Symbol(
  "IDENTITY_AI_ACCESS_TOKEN_REPOSITORY_PORT",
);
