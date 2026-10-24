import { finishResearchToolFor, parseDecision } from "../selection-qa-decision";
import { QaEvidenceLedger, qaEvidenceResult } from "../qa-evidence";
import type { QaCurrentBook } from "../selection-qa-runtime.port";
import { SelectionQaError } from "../selection-qa.types";
import { qaKeys, type QaRegisteredTool } from "./qa-tool-registry";

export function createQaDeliveryTools(ledger: QaEvidenceLedger, currentBook: QaCurrentBook): QaRegisteredTool[] {
  return [{
    kind: "delivery", operation: "finish_research",
    definition: () => finishResearchToolFor([...ledger.items.keys()]),
    fingerprint: args => JSON.stringify(args),
    execute: async args => {
      const decision = parseDecision(args, ledger.items);
      const selected = new Set(decision.selectedEvidenceIds);
      return { observationStatus: "success", progress: "delivery", delivery: { decision }, data: {
        ...decision, sourceBook: currentBook, rejectedEvidenceIds: [...ledger.items.keys()].filter(id => !selected.has(id)),
        results: [...ledger.items.values()].map(e => ({ ...qaEvidenceResult(e, currentBook), selected: selected.has(e.evidenceId) })),
      } };
    },
  }, {
    kind: "delivery", operation: "request_clarification",
    definition: () => ({ type: "function", function: { name: "request_clarification", strict: true,
      description: "Ask the user a necessary clarification when their intent cannot be resolved from the question and conversation. The current turn delivers the question; the user's reply continues in the same conversation.",
      parameters: { type: "object", properties: { question: { type: "string", minLength: 1, maxLength: 600 } }, required: ["question"], additionalProperties: false },
    } }),
    fingerprint: args => JSON.stringify(args),
    execute: async args => {
      qaKeys(args, ["question"]);
      if (typeof args.question !== "string" || !args.question.trim() || args.question.length > 600)
        throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { field: "question", constraint: "1-600 characters" });
      return { observationStatus: "success", data: { clarificationRequested: true }, progress: "delivery",
        delivery: { clarification: args.question } };
    },
  }];
}
