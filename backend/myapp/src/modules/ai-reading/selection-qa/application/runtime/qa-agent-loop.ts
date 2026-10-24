import { QA_POLICY, QaProgressGuard } from "../../domain/qa-policy";
import type { QaClaim, QaCurrentBook, QaMessage, QaModelPort, QaRuntimeStore, QaSavedEvidence } from "../selection-qa-runtime.port";
import { SelectionQaError } from "../selection-qa.types";
import { QueryArgumentError } from "../selection-qa-query-policy";
import { QaContextBuilder } from "../qa-context";
import { qaArguments, QaToolRegistry, type QaDeliveryIntent } from "../tools/qa-tool-registry";
import { checkQaSignal, qaAwait } from "./qa-await";

export interface QaLoopInput {
  claim: QaClaim;
  currentBook: QaCurrentBook;
  history: ReturnType<QaRuntimeStore["history"]>;
  messages: QaMessage[];
  evidence: Map<string, QaSavedEvidence>;
  registry: QaToolRegistry;
  signal: AbortSignal;
  searchOutcome: { succeeded: number; failed: number };
}
export interface QaLoopResult extends QaDeliveryIntent { limitReason?: string }

/** Generic execution semantics: no book-tool names or business stages. */
export class QaAgentLoop {
  constructor(private readonly store: QaRuntimeStore, private readonly model: QaModelPort, private readonly context: QaContextBuilder) {}

  async run(input: QaLoopInput): Promise<QaLoopResult> {
    const { claim, messages, registry, signal } = input;
    const deadline = claim.turn.deadline - QA_POLICY.finalReserveMs;
    const actionSignal = new AbortController();
    const abort = () => actionSignal.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => actionSignal.abort("RESEARCH_BUDGET_EXHAUSTED"), Math.max(0, deadline - Date.now()));
    const progress = new QaProgressGuard();
    let limitReason: string | undefined;
    let executingCallId: string | undefined;
    try {
      while (this.store.remaining(claim).models > 2 && Date.now() < deadline) {
        checkQaSignal(signal);
        let modelInput;
        try {
          modelInput = this.context.build({ ...input, tools: registry.definitions(), signal: actionSignal.signal, final: false, deadline });
        } catch (error) {
          if (error instanceof SelectionQaError && error.code === "INPUT_TOKEN_LIMIT") return { limitReason: error.code };
          throw error;
        }
        this.store.reserveModel(claim, "decision");
        const startedAt = Date.now();
        this.store.phase(claim, "planning", { operation: "model", state: "started", callKind: "decision" });
        const planned = await qaAwait(() => this.model.complete(claim.turn.userId, claim.snapshot, modelInput), actionSignal.signal);
        this.store.usage(claim, planned.usage, modelInput.maxOutputTokens);
        this.store.phase(claim, "planning", { operation: "model", state: "completed", callKind: "decision", elapsedMs: Date.now() - startedAt,
          toolCount: planned.toolCalls.length, ...planned.usage });
        if (planned.toolCalls.length > QA_POLICY.maxToolCalls || new Set(planned.toolCalls.map(c => c.id)).size !== planned.toolCalls.length)
          throw new SelectionQaError("MODEL_TOOL_PROTOCOL_INVALID");
        const definitions = planned.toolCalls.map(call => registry.require(call.name));
        if (definitions.some(t => t.kind === "delivery") && definitions.length !== 1)
          throw new SelectionQaError("MODEL_CONTROL_TOOL_MIXED");
        // Providers reject an assistant turn that has neither content nor tool calls.
        if (planned.toolCalls.length || planned.content)
          messages.push({ role: "assistant", content: planned.content ?? null, reasoningContent: planned.reasoningContent,
            ...(planned.toolCalls.length ? { toolCalls: planned.toolCalls } : {}) });
        if (!planned.toolCalls.length) {
          this.store.phase(claim, "planning", { operation: "decision_protocol", state: "failed", observationStatus: "recoverable_error", errorCode: "MODEL_DECISION_REQUIRED" });
          messages.push({ role: "user", content: "No action was executed. Choose an available tool, answer delivery, or clarification using its exact schema. Your intermediate prose is not a published answer or verified evidence." });
          progress.observe("missing_action", "missing_action");
          if (progress.blocked("missing_action")) return { limitReason: "NO_PROGRESS" };
          continue;
        }
        let blocked = false;
        for (let i = 0; i < planned.toolCalls.length; i++) {
          checkQaSignal(actionSignal.signal);
          const call = planned.toolCalls[i], tool = definitions[i], at = Date.now();
          const phase = tool.kind === "delivery" ? "planning" : "retrieving";
          const publish = (observationStatus: string, state: string, data: Record<string, unknown>, modelObservation = data) => {
            this.store.phase(claim, phase, { operation: tool.operation, callId: call.id, state, observationStatus, elapsedMs: Date.now() - at, ...data });
            messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify({ operationKind: tool.kind, observationStatus, ...modelObservation }) });
          };
          const remaining = this.store.remaining(claim);
          if (Date.now() >= deadline || (tool.kind === "reading" && (remaining.tools === 0 || remaining.chars === 0))) {
            limitReason = "RESEARCH_BUDGET_EXHAUSTED";
            publish("not_executed", "not_executed", { reason: limitReason });
            continue;
          }
          // Reserve attempted reading even for recoverable parameter errors.
          if (tool.kind === "reading") this.store.reserveTool(claim);
          let fingerprint = `${tool.operation}:${call.arguments}`;
          try {
            const args = qaArguments(call.arguments);
            fingerprint = `${tool.operation}:${tool.fingerprint(args)}`;
            if (progress.blocked(fingerprint)) {
              publish("not_executed", "not_executed", { reason: "NO_PROGRESS", instruction: "This action repeatedly returned the same observation. Use a different lead or deliver the available result." });
              blocked = true;
              continue;
            }
            this.store.phase(claim, phase, { operation: tool.operation, callId: call.id, state: "started", arguments: args, ...tool.details?.(args) });
            executingCallId = call.id;
            const result = await qaAwait(() => tool.execute(args, actionSignal.signal, deadline), actionSignal.signal);
            executingCallId = undefined;
            if (result.progress !== undefined)
              progress.observe(fingerprint, result.progress);
            if (limitReason === "NO_PROGRESS" && result.observationStatus !== "not_executed") limitReason = undefined;
            publish(result.observationStatus, result.observationStatus === "not_executed" ? "not_executed" : "completed", result.data, result.modelObservation);
            if (result.observationStatus === "not_executed" && result.data.reason === "READ_BUDGET_EXHAUSTED") limitReason = "RESEARCH_BUDGET_EXHAUSTED";
            if (result.delivery) return { ...result.delivery, ...(limitReason ? { limitReason } : {}) };
          } catch (error) {
            if (!(error instanceof SelectionQaError) || error.code !== "TOOL_ARGUMENTS_INVALID") {
              if (!actionSignal.signal.aborted) this.store.phase(claim, phase, {
                operation: tool.operation, callId: call.id, state: "failed", observationStatus: "failed",
                errorCode: error instanceof SelectionQaError ? error.code : "TOOL_EXECUTION_FAILED",
              });
              throw error;
            }
            tool.onRecoverableError?.();
            const validation = error instanceof QueryArgumentError ? error.validation : error.current;
            const validations = error instanceof QueryArgumentError ? error.validations : undefined;
            progress.observe(fingerprint, JSON.stringify({ error: error.code, validation }));
            publish("recoverable_error", "failed", { error: error.code, errorCode: error.code, validation, validations,
              instruction: "Correct the parameters using the supplied schema and validations. No book operation was performed; this is not an empty search result." });
          }
        }
        if (blocked) limitReason = "NO_PROGRESS";
      }
      return { limitReason: limitReason ?? "RESEARCH_BUDGET_EXHAUSTED" };
    } catch (error) {
      checkQaSignal(signal);
      if (actionSignal.signal.aborted && actionSignal.signal.reason === "RESEARCH_BUDGET_EXHAUSTED") {
        const reverseIndex = [...messages].reverse().findIndex(message => message.role === "assistant");
        const lastIndex = reverseIndex < 0 ? -1 : messages.length - reverseIndex - 1;
        const last = messages[lastIndex];
        const answered = new Set(messages.slice(lastIndex + 1).filter(m => m.role === "tool").map(m => m.toolCallId));
        for (const call of last?.toolCalls ?? []) if (!answered.has(call.id)) {
          const tool = registry.require(call.name);
          const observationStatus = call.id === executingCallId ? "interrupted" : "not_executed";
          const data = { operationKind: tool.kind, observationStatus, reason: "RESEARCH_BUDGET_EXHAUSTED" };
          messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(data) });
          this.store.phase(claim, "retrieving", { operation: tool.operation, callId: call.id, state: observationStatus === "interrupted" ? "failed" : "not_executed", ...data });
        }
        return { limitReason: "RESEARCH_BUDGET_EXHAUSTED" };
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
}
