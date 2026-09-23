import type {
  ModelCapabilityCatalog,
  ModelConfigPort,
} from "../../../../support/ai-model/public";
import { LanguageModelError } from "../../../../support/ai-model/public";
import type {
  BookAnalysisModelCapabilityPort,
} from "../application/ports/book-analysis-model-capability.port";
import type {
  BookAnalysisModelConfigPort,
  BookAnalysisModelCredential,
} from "../application/ports/book-analysis-model-config.port";

export class AiModelBookAnalysisAccessAdapter implements
  BookAnalysisModelConfigPort,
  BookAnalysisModelCapabilityPort
{
  constructor(
    private readonly configs: ModelConfigPort,
    private readonly capabilities: ModelCapabilityCatalog,
  ) {}

  getCredential(userId: number): BookAnalysisModelCredential | null {
    return this.configs.getCredential(userId);
  }

  supportsStrictTools(credential: Readonly<BookAnalysisModelCredential>): boolean {
    try {
      this.capabilities.assertCapability(
        credential.provider,
        credential.modelId,
        "strictTools",
      );
      return true;
    } catch (error) {
      if (error instanceof LanguageModelError && error.kind === "capability_unsupported") return false;
      throw error;
    }
  }
}
