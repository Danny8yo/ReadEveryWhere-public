import { SelectionQaError } from "./selection-qa.types";
import type { QaBookPort, QaClaim, QaCurrentBookPort, QaModelPort, QaRuntimeStore, QaMessage } from "./selection-qa-runtime.port";
import { QaEvidenceLedger } from "./qa-evidence";
import { QaContextBuilder } from "./qa-context";
import { QaDelivery } from "./qa-delivery";
import { QaQualityCheck } from "./qa-quality";
import { QA_POLICY } from "../domain/qa-policy";
import type { QaStructuredBookPort } from "./qa-structured-book.port";
import { createQaStructureTools } from "./tools/qa-structure-tools";
import { QaToolRegistry } from "./tools/qa-tool-registry";
import { QaAgentLoop } from "./runtime/qa-agent-loop";
import { checkQaSignal } from "./runtime/qa-await";
import type { QaReadingEnvironment } from "./tools/qa-reading-tools";
export type QaToolsFactory = (environment: QaReadingEnvironment) => QaToolRegistry;
/** One-turn use case: trusted setup, execution, delivery, and terminal protection. */
export class SelectionQaExecutor {
  constructor(
    private readonly store: QaRuntimeStore,
    private readonly model: QaModelPort,
    private readonly books: QaBookPort,
    private readonly currentBooks: QaCurrentBookPort,
    private readonly createTools: QaToolsFactory,
    private readonly structure?: QaStructuredBookPort,
  ) {}
  async run(claim: QaClaim, signal: AbortSignal): Promise<void> {
    try {
      checkQaSignal(signal);
      const currentBook = this.currentBooks.get(claim.turn.userId, claim.conversation.bookId);
      this.store.phase(claim, "context", { operation: "source_context", state: "completed", sourceBook: currentBook });
      const history = this.store.history(claim);
      const ledger = new QaEvidenceLedger(claim, this.store);
      const searchOutcome = { succeeded: 0, failed: 0 };
      const environment = { claim, currentBook, history, ledger, searchOutcome, store: this.store, books: this.books };
      const baseRegistry = this.createTools(environment);
      const registry = this.structure ? new QaToolRegistry([...baseRegistry.registrations(), ...createQaStructureTools(environment, this.structure)]) : baseRegistry;
      const context = new QaContextBuilder(this.model, this.store);
      const messages: QaMessage[] = [];
      const input = { claim, currentBook, history, messages, evidence: ledger.items, searchOutcome, registry, signal, coverage: () => ledger.coverage.snapshot() };
      for (let answerVersion = 1; answerVersion <= QA_POLICY.maxAnswerVersions; answerVersion++) {
        const result = await new QaAgentLoop(this.store, this.model, context).run(input);
        checkQaSignal(signal);
        const evidence = result.decision
          ? new Map(result.decision.selectedEvidenceIds.map(id => [id, ledger.require(id)]))
          : result.clarification ? new Map() : ledger.items;
        const deliveryInput = { ...input, ...result, evidence, answerVersion };
        const draft = await new QaDelivery(this.store, this.model, context).deliver(deliveryInput);
        // The checker must see all acquired passages, including qualifications
        // excluded from delivery. Overflow fails explicitly instead of certifying
        // a draft using a conveniently incomplete evidence subset.
        const judgment = await new QaQualityCheck(this.store, this.model, context).check({ ...deliveryInput, evidence: ledger.items }, draft.answer);
        checkQaSignal(signal);
        if (judgment.verdict === "pass") {
          this.store.finish(claim, "completed", null);
          return;
        }
        if (answerVersion === QA_POLICY.maxAnswerVersions || this.store.remaining(claim).models < 3)
          throw new SelectionQaError(judgment.verdict === "insufficient" ? "QUALITY_EVIDENCE_INSUFFICIENT" : "QUALITY_REVISION_EXHAUSTED");
        this.store.phase(claim, "revising", { operation: "revision", state: "started", answerVersion, verdict: judgment.verdict });
        // An assistant turn without content or tool calls is an invalid provider message (HTTP 400).
        messages.push({ role: "user", content: JSON.stringify({
          feedbackKind: "fallible_quality_assessment_not_source_evidence", answerVersion,
          rejectedDraft: draft.answer, issues: judgment.issues,
          instruction: "Resolve these risks against original evidence. Continue research if needed, then select evidence and deliver a new complete answer. Do not merely repeat the rejected answer. Do not promote the assessment into book facts.",
        }) });
      }
    } catch (error) {
      const reason = signal.aborted
        ? String(signal.reason)
        : error instanceof SelectionQaError
          ? error.code
          : this.errorCode(error);
      try {
        this.store.finish(
          claim,
          reason === "DEADLINE_EXCEEDED" ? "timed_out" : "failed",
          reason,
        );
      } catch (finishError) {
        if (!(
          finishError instanceof SelectionQaError &&
          [
            "LEASE_LOST",
            "CONTENT_VERSION_CHANGED",
            "DEADLINE_EXCEEDED",
          ].includes(finishError.code)
        ))
          throw finishError;
      }
      if (
        !(error instanceof SelectionQaError) &&
        !signal.aborted &&
        !this.isKnown(error)
      )
        throw error;
    }
  }
  private isKnown(error: unknown) {
    return (
      error instanceof Error &&
      ["ReaderToolException", "LanguageModelError"].includes(
        error.constructor.name,
      )
    );
  }
  private errorCode(error: unknown) {
    if (error instanceof Error && "details" in error) {
      const details = error.details;
      if (details && typeof details === "object" && "reason" in details && typeof details.reason === "string")
        return details.reason;
    }
    if (error instanceof Error && "code" in error)
      return String((error as Error & { code: unknown }).code);
    return "INTERNAL_EXECUTION_ERROR";
  }
}
