import type {
  AiAccessTokenPrincipal,
  AiAccessTokenSummary,
  CreatedAiAccessToken,
} from "../domain/ai-access-token.types";
import { IdentityApplicationError } from "./identity-application.error";
import type { AiAccessTokenRepositoryPort } from "./ports/ai-access-token-repository.port";

export class AiAccessTokenService {
  constructor(private readonly repository: AiAccessTokenRepositoryPort) {}

  create(userId: number, name: string, expiresInDays: number): CreatedAiAccessToken {
    const expiresAt = new Date();
    expiresAt.setUTCDate(expiresAt.getUTCDate() + expiresInDays);
    return this.repository.create(
      userId,
      name.trim(),
      ["books:read", "annotations:read"],
      expiresAt,
    );
  }

  list(userId: number): AiAccessTokenSummary[] {
    return this.repository.listByUser(userId);
  }

  revoke(userId: number, tokenId: string): { revoked: true } {
    if (!this.repository.revoke(userId, tokenId)) {
      throw IdentityApplicationError.notFound(
        "id",
        "AI access token not found or already revoked",
      );
    }
    return { revoked: true };
  }

  verify(token: string): AiAccessTokenPrincipal | null {
    return this.repository.verify(token);
  }
}
