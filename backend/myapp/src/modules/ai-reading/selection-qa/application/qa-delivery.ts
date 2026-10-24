import type { QaResearchDecision } from "./selection-qa-decision";
import { QaContextBuilder } from "./qa-context";
import type {
  QaClaim,
  QaCurrentBook,
  QaMessage,
  QaModelPort,
  QaRuntimeStore,
  QaSavedEvidence,
} from "./selection-qa-runtime.port";
import { SelectionQaError } from "./selection-qa.types";

export interface QaDeliveryInput {
  claim: QaClaim;
  answerVersion: number;
  currentBook: QaCurrentBook;
  history: ReturnType<QaRuntimeStore["history"]>;
  messages: QaMessage[];
  evidence: Map<string, QaSavedEvidence>;
  signal: AbortSignal;
  decision?: QaResearchDecision;
  clarification?: string;
  limitReason?: string;
  searchOutcome: { succeeded: number; failed: number };
}

/** Owns final model streaming and citation publication, never research actions. */
export class QaDelivery {
  constructor(
    private readonly store: QaRuntimeStore,
    private readonly model: QaModelPort,
    private readonly builder: QaContextBuilder,
  ) {}

  async deliver(value: QaDeliveryInput): Promise<{ answer: string; citedEvidenceIds: string[] }> {
    const { claim, signal, evidence, decision } = value;
    this.check(signal);
    const input = this.builder.build({ ...value, tools: [], final: true, deadline: claim.turn.deadline });
    this.store.reserveModel(claim, "final");
    this.store.beginAnswer(claim, value.answerVersion);
    let buffer = "";
    let answer = "";
    let generatedText = "";
    const cited = new Set<string>();
    const aliases = new Map([...evidence.values()].map((item, index) => [`s${index + 1}`, item]));
    const flush = (final: boolean) => {
      let output = "";
      const citations: QaSavedEvidence[] = [];
      while (buffer) {
        const formats = [
          { prefix: "[[evidence:", idStart: 11, close: "]]" },
          { prefix: "[[e_", idStart: 2, close: "]]" },
          { prefix: "[^e_", idStart: 2, close: "]" },
        ];
        const match = formats.map(format => ({ ...format, at: buffer.indexOf(format.prefix) }))
          .filter(format => format.at >= 0).sort((a, b) => a.at - b.at)[0];
        if (!match) {
          let keep = 0;
          if (!final) {
            for (const { prefix } of formats)
              for (let size = 1; size <= prefix.length; size++)
                if (buffer.endsWith(prefix.slice(0, size))) keep = Math.max(keep, size);
          }
          output += buffer.slice(0, buffer.length - keep);
          buffer = buffer.slice(buffer.length - keep);
          break;
        }
        output += buffer.slice(0, match.at);
        buffer = buffer.slice(match.at);
        const close = buffer.indexOf(match.close, match.prefix.length);
        if (close < 0) {
          if (final || buffer.length > 160) throw new SelectionQaError("CITATION_INVALID");
          break;
        }
        const id = buffer.slice(match.idStart, close);
        const item = aliases.get(id) ?? evidence.get(id);
        if (!item) {
          this.store.phase(claim, "answer", {
            operation: "citation_validation", state: "failed", errorCode: "CITATION_INVALID",
            reason: "unknown_reference", reference: id.slice(0, 80),
          });
          throw new SelectionQaError("CITATION_INVALID");
        }
        output += `[[evidence:${item.evidenceId}]]`;
        buffer = buffer.slice(close + match.close.length);
        if (!cited.has(item.evidenceId)) {
          cited.add(item.evidenceId);
          citations.push(item);
        }
      }
      if (output || citations.length) {
        this.store.append(claim, output, citations);
        answer += output;
      }
    };
    const started = Date.now();
    this.store.phase(claim, "answer", {
      operation: "stream", state: "started", modelId: claim.snapshot.modelId,
      evidenceCount: evidence.size,
      evidenceChars: [...evidence.values()].reduce((total, item) => total + item.quote.length, 0),
      researchLimited: Boolean(value.limitReason) || value.searchOutcome.failed > 0 || [...evidence.values()].some(item => item.contextTruncated),
      ...(value.clarification ? { deliveryKind: "clarification" } : {}),
    });
    let firstDeltaAt: number | null = null;
    let lastDeltaAt: number | null = null;
    let deltaCount = 0;
    let acceptingDeltas = true;
    this.check(signal);
    const completion = await this.wait(this.model.stream(
      claim.turn.userId,
      claim.snapshot,
      input,
      async delta => {
        this.check(signal);
        if (!acceptingDeltas) throw new SelectionQaError("ANSWER_VERSION_FROZEN");
        deltaCount++;
        lastDeltaAt = Date.now();
        if (firstDeltaAt === null) {
          firstDeltaAt = lastDeltaAt;
          this.store.phase(claim, "answer", { operation: "stream", state: "first_delta", elapsedMs: firstDeltaAt - started });
        }
        generatedText += delta;
        buffer += delta;
        flush(false);
      },
    ), signal).finally(() => { acceptingDeltas = false; });
    this.check(signal);
    flush(true);
    this.store.phase(claim, "answer", {
      operation: "stream", state: "completed", finishReason: completion.finishReason,
      promptTokens: completion.usage.promptTokens,
      completionTokens: completion.usage.completionTokens,
      totalTokens: completion.usage.totalTokens,
      elapsedMs: Date.now() - started,
      firstDeltaMs: firstDeltaAt === null ? null : firstDeltaAt - started,
      deliveryMs: firstDeltaAt === null || lastDeltaAt === null ? null : lastDeltaAt - firstDeltaAt,
      deltaCount,
    });
    this.store.usage(claim, completion.usage, input.maxOutputTokens);
    if (!generatedText.trim() || !answer.trim())
      throw new SelectionQaError(completion.finishReason === "length" ? "OUTPUT_LIMIT" : completion.finishReason !== "stop" ? "MODEL_STREAM_INCOMPLETE" : "EMPTY_MODEL_ANSWER");
    if (completion.finishReason === "stop" && evidence.size && !cited.size && !value.limitReason && !value.clarification &&
      (!decision || (decision.insufficientEvidence.length === 0 && decision.externalEvidenceNeeded.length === 0)))
      throw new SelectionQaError("CITATION_INVALID");
    const reason = completion.finishReason === "length"
      ? "OUTPUT_LIMIT"
      : completion.finishReason !== "stop"
        ? "MODEL_STREAM_INCOMPLETE"
        : value.limitReason ?? null;
    if (reason) throw new SelectionQaError(reason);
    return { answer, citedEvidenceIds: [...cited] };
  }

  private check(signal: AbortSignal): void {
    if (signal.aborted) throw new SelectionQaError(String(signal.reason));
  }

  private wait<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => reject(new SelectionQaError(String(signal.reason)));
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
}
