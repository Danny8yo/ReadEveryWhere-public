import { SetMetadata } from "@nestjs/common";
import type { AiAccessScope } from "../domain/ai-access-token.types";

export const AI_ACCESS_SCOPES_KEY = "aiAccessScopes";

export const AllowAiAccess = (...scopes: AiAccessScope[]) =>
  SetMetadata(AI_ACCESS_SCOPES_KEY, scopes);
