import type { AiAccessScope } from "../domain/ai-access-token.types";

export interface RequestPrincipal {
  userId: number;
  email: string;
  authType?: "session" | "ai_access_token";
  sessionId?: string;
  aiTokenId?: string;
  scopes?: AiAccessScope[];
}
