import { createHash } from "node:crypto";
import { QaContextBuilder } from "./qa-context";
import type { QaDeliveryInput } from "./qa-delivery";
import type { QaModelPort, QaQualityJudgment, QaRuntimeStore, QaTool } from "./selection-qa-runtime.port";
import { SelectionQaError } from "./selection-qa.types";
import { qaAwait } from "./runtime/qa-await";

export const qaFingerprint = (value: unknown): string => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

/** A fallible semantic assessment of the actual frozen output, never source evidence. */
export class QaQualityCheck {
  constructor(private readonly store: QaRuntimeStore, private readonly model: QaModelPort, private readonly context: QaContextBuilder) {}

  async check(value: QaDeliveryInput, answer: string): Promise<QaQualityJudgment> {
    const { claim, evidence } = value;
    const aliases = [...evidence.keys()];
    const tool: QaTool = { type: "function", function: { name: "assess_answer", strict: true,
      description: "Assess the actual answer. pass only if it addresses the question with supported book claims, preserved qualifications, honest scope and necessary general knowledge. Return actionable issues for correction or missing evidence.",
      parameters: { type: "object", additionalProperties: false, required: ["verdict", "issues"], properties: {
        verdict: { type: "string", enum: ["pass", "revise", "insufficient"] },
        issues: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["claim", "problem", "evidenceIds", "action"], properties: {
          claim: { type: "string", maxLength: 1000 }, problem: { type: "string", maxLength: 1000 }, action: { type: "string", maxLength: 1000 },
          evidenceIds: { type: "array", maxItems: 12, items: { type: "string", ...(aliases.length ? { enum: aliases.map((_, i) => `s${i + 1}`) } : {}) } },
        } } },
      } } } };
    const modelAnswer = answer.replace(/\[\[evidence:([^\]]+)\]\]/g, (_m, id: string) => {
      const index = aliases.indexOf(id);
      if (index < 0) throw new SelectionQaError("CITATION_INVALID");
      return `[[evidence:s${index + 1}]]`;
    });
    const input = this.context.build({ ...value, final: true, qualityAnswer: modelAnswer, tools: [tool], deadline: claim.turn.deadline });
    this.store.reserveModel(claim, "check");
    this.store.phase(claim, "checking", { operation: "quality_check", state: "started", answerVersion: value.answerVersion, policy: "all-answers-v1" });
    const result = await qaAwait(() => this.model.complete(claim.turn.userId, claim.snapshot, input), value.signal);
    this.store.usage(claim, result.usage, input.maxOutputTokens);
    if (result.toolCalls.length !== 1 || result.toolCalls[0].name !== "assess_answer") throw new SelectionQaError("QUALITY_PROTOCOL_INVALID");
    let parsed: unknown;
    try { parsed = JSON.parse(result.toolCalls[0].arguments); } catch { throw new SelectionQaError("QUALITY_PROTOCOL_INVALID"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SelectionQaError("QUALITY_PROTOCOL_INVALID");
    const raw = parsed as Record<string, unknown>;
    if (Object.keys(raw).sort().join() !== "issues,verdict" || !["pass", "revise", "insufficient"].includes(String(raw.verdict)) || !Array.isArray(raw.issues) || raw.issues.length > 12)
      throw new SelectionQaError("QUALITY_PROTOCOL_INVALID");
    const issues = raw.issues.map((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new SelectionQaError("QUALITY_PROTOCOL_INVALID");
      const issue = item as Record<string, unknown>;
      if (Object.keys(issue).sort().join() !== "action,claim,evidenceIds,problem" || ["claim", "problem", "action"].some(k => typeof issue[k] !== "string" || !(issue[k] as string).trim() || (issue[k] as string).length > 1000) || !Array.isArray(issue.evidenceIds) || issue.evidenceIds.length > 12)
        throw new SelectionQaError("QUALITY_PROTOCOL_INVALID");
      const evidenceIds = issue.evidenceIds.map((id: unknown) => {
        if (typeof id !== "string" || !/^s[1-9]\d*$/.test(id) || !aliases[Number(id.slice(1)) - 1]) throw new SelectionQaError("QUALITY_PROTOCOL_INVALID");
        return aliases[Number(id.slice(1)) - 1];
      });
      return { claim: issue.claim as string, problem: issue.problem as string, action: issue.action as string, evidenceIds };
    });
    if ((raw.verdict === "pass") !== (issues.length === 0)) throw new SelectionQaError("QUALITY_PROTOCOL_INVALID");
    const judgment: QaQualityJudgment = {
      answerVersion: value.answerVersion, generation: claim.generation, answerHash: qaFingerprint(answer),
      evidenceFingerprint: qaFingerprint([...evidence.values()]), inputFingerprint: qaFingerprint({ messages: input.messages, tools: input.tools }),
      evidenceIds: [...evidence.keys()],
      revision: claim.conversation.selection.scope, policy: "all-answers-v1", verdict: raw.verdict as QaQualityJudgment["verdict"], issues,
    };
    this.store.quality(claim, judgment);
    return judgment;
  }
}
