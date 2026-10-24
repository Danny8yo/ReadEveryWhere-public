import { RerankerError, type RerankerPort, type RerankerSettings } from "../../../../support/ai-model/public";
import { QaRerankError, type QaRerankerPort, type QaSearchMode } from "../application/selection-qa-runtime.port";

/** Translates provider-neutral reranker failures into the QA-owned failure classes. */
export class SelectionQaRerankerAdapter implements QaRerankerPort {
  readonly identity: QaRerankerPort["identity"];
  constructor(private readonly reranker: RerankerPort) { this.identity = reranker.identity; }
  async rank(input: Parameters<QaRerankerPort["rank"]>[0]) {
    try {
      return await this.reranker.rank(input);
    } catch (error) {
      if (error instanceof RerankerError) throw new QaRerankError(error.kind, error.message);
      throw error;
    }
  }
}
/** SELECTION_QA_SCREENING=llm|none; none removes LLM candidate screening and therefore needs a reranker. */
export function selectionQaSearchMode(settings: RerankerSettings, value = process.env.SELECTION_QA_SCREENING): QaSearchMode {
  const screening = value || "llm";
  if (screening !== "llm" && screening !== "none") throw new Error(`SELECTION_QA_SCREENING must be llm or none, got ${screening}`);
  if (!settings.enabled) {
    if (screening === "none") throw new Error("SELECTION_QA_SCREENING=none requires SELECTION_QA_RERANKER");
    return { reranker: null, screening: "llm" };
  }
  return { reranker: new SelectionQaRerankerAdapter(settings.reranker), screening };
}
