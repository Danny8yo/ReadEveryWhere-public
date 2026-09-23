import { SelectionQaError } from "./selection-qa.types";
import type { QaSavedEvidence, QaTool } from "./selection-qa-runtime.port";
import { BOOK_MAX_EXPAND_SELECTED } from "../../../intelligent-library/public/book-retrieval.port";
export type QaSourceTarget = "current_book" | "model_knowledge" | "other_book_unverified";
export const MAX_SELECTED_CANDIDATES = BOOK_MAX_EXPAND_SELECTED;
export const MAX_INFORMATION_NEEDS = 16;
export interface QaInformationNeed {
  text: string;
  targetSource: QaSourceTarget;
  /** User/model-mentioned source, never a verified catalog identity. */
  sourceName: string;
  evidenceIds: string[];
}
export interface QaResearchDecision {
  informationNeeds: QaInformationNeed[];
  selectedEvidenceIds: string[];
  externalEvidenceNeeded: string[];
  insufficientEvidence: string[];
  conclusion: string;
}
const strings = (maxItems: number, maxLength: number) => ({ type: "array", items: { type: "string", minLength: 1, maxLength }, maxItems });
export const finishResearchTool: QaTool = {
  type: "function",
  function: {
    name: "finish_research", strict: true,
    description: `End research ALONE. Classify each information need by source: current_book, model_knowledge, or other_book_unverified. For current_book needs, nominate directly supporting evidence IDs in descending priority. The host deterministically applies the shared limit of ${MAX_SELECTED_CANDIDATES} retrieved candidates and researchBudget.maxSelectedCandidateChars across all needs; lower-priority nominations beyond that budget are omitted rather than making the turn fail. A current_book need may link multiple evidence IDs when needed. When the question attributes words to another named book, include an other_book_unverified need with that title; its wording is unverified, but still explain useful concepts from model knowledge. Only current_book needs can select book evidence. Initial/history context may also be selected and does not count as a retrieved candidate. General knowledge needs no book evidence. Do not use this book to verify another book's contents. List genuinely unverifiable external facts and insufficient book evidence. Use concise Chinese operational conclusions, not a draft answer.`,
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        informationNeeds: { type: "array", minItems: 1, maxItems: MAX_INFORMATION_NEEDS, description: `Current-question needs with explicit source targets. Keep the list concise and use at most ${MAX_INFORMATION_NEEDS} needs. For each current_book need, nominate evidence in descending priority; the host applies the shared candidate count and character budget across all needs. sourceName is the mentioned other book title only for other_book_unverified; otherwise use an empty string. Do not invent follow-up tasks.`, items: { type: "object", additionalProperties: false, properties: {
          text: { type: "string", minLength: 1, maxLength: 200 },
          targetSource: { type: "string", enum: ["current_book", "model_knowledge", "other_book_unverified"] },
          sourceName: { type: "string", maxLength: 200 },
          evidenceIds: strings(MAX_SELECTED_CANDIDATES, 80),
        }, required: ["text", "targetSource", "sourceName", "evidenceIds"] } },
        externalEvidenceNeeded: { ...strings(8, 200), description: "Do not list stable terminology, conceptual explanations or established general technical knowledge here. Only facts requiring unavailable verification explicitly requested by the current user question, such as a specific present-day product effect or current price. Return [] for questions asking to explain a book concept, mechanism, historical account or author viewpoint. Book evidence suffices to explain what the book says: do not independently verify its references, statistics, or technical details unless the user explicitly asks. Never add unasked current versions, defaults, exact measurements, original papers or alternative editions." },
        insufficientEvidence: { ...strings(8, 200), description: "Only missing evidence that prevents answering an information need in the current question. Return [] when selected passages answer the question. Unasked details, exhaustive coverage and independent verification of the book are not missing evidence." },
        conclusion: { type: "string", minLength: 1, maxLength: 1200, description: "A brief operational conclusion: normally one sentence under 100 characters. State why research ends; do not draft the answer or repeat passages. Hard limit 1200 UTF-16 code units." },
      },
      required: ["informationNeeds", "externalEvidenceNeeded", "insufficientEvidence", "conclusion"],
    },
  },
};
export function finishResearchToolFor(evidenceIds: readonly string[]): QaTool {
  const tool = structuredClone(finishResearchTool);
  if (evidenceIds.length) {
    const parameters = tool.function.parameters as { properties: { informationNeeds: { items: { properties: { evidenceIds: { items: Record<string, unknown> } } } } } };
    parameters.properties.informationNeeds.items.properties.evidenceIds.items.enum = [...evidenceIds];
  }
  return tool;
}
export function parseDecision(raw: Record<string, unknown>, evidence: Map<string, QaSavedEvidence>): QaResearchDecision {
  const fields = ["informationNeeds", "externalEvidenceNeeded", "insufficientEvidence", "conclusion"];
  if (Object.keys(raw).length !== fields.length || Object.keys(raw).some(k => !fields.includes(k)))
    throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { field: "finish_research", constraint: "exactly the four required decision fields", keys: Object.keys(raw) });
  const needs = raw.informationNeeds;
  if (!Array.isArray(needs) || needs.length < 1 || needs.length > MAX_INFORMATION_NEEDS)
    throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { field: "informationNeeds", constraint: `1-${MAX_INFORMATION_NEEDS} source-targeted needs` });
  const selectedEvidenceIds: string[] = [];
  for (const need of needs) {
    if (!need || typeof need !== "object" || Array.isArray(need))
      throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { field: "informationNeeds", constraint: "source-targeted objects" });
    const item = need as Record<string, unknown>;
    if (Object.keys(item).length !== 4 || ["text", "targetSource", "sourceName", "evidenceIds"].some(key => !(key in item)) ||
      typeof item.text !== "string" || !item.text.trim() || item.text.length > 200 ||
      !["current_book", "model_knowledge", "other_book_unverified"].includes(String(item.targetSource)) ||
      typeof item.sourceName !== "string" || item.sourceName.length > 200 ||
      !Array.isArray(item.evidenceIds) ||
      item.evidenceIds.some(id => typeof id !== "string" || !id || id.length > 80) ||
      new Set(item.evidenceIds).size !== item.evidenceIds.length)
      throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { field: "informationNeeds", constraint: "valid source target, sourceName and current-book-only evidence IDs" });
    if (item.targetSource === "other_book_unverified" ? !item.sourceName.trim() : item.sourceName !== "")
      throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { field: "informationNeeds.sourceName", constraint: "nonblank for other_book_unverified, empty otherwise", targetSource: item.targetSource });
    if (item.targetSource !== "current_book" && item.evidenceIds.length > 0)
      throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { field: "informationNeeds.evidenceIds", constraint: "only current_book needs may reference book evidence", targetSource: item.targetSource });
    for (const id of item.evidenceIds as string[]) if (!selectedEvidenceIds.includes(id)) selectedEvidenceIds.push(id);
  }
  for (const key of ["externalEvidenceNeeded", "insufficientEvidence"] as const) {
    const value = raw[key];
    if (!Array.isArray(value) || value.length > 8 ||
      value.some(s => typeof s !== "string" || !s.trim() || s.length > 200) || new Set(value).size !== value.length)
      throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { field: key, constraint: "unique nonblank strings, <=8 items, each 1-200 characters", itemCount: Array.isArray(value) ? value.length : null, maxItemLength: Array.isArray(value) ? Math.max(0, ...value.filter(s => typeof s === "string").map(s => s.length)) : null });
  }
  if (typeof raw.conclusion !== "string" || !raw.conclusion.trim() || raw.conclusion.length > 1200)
    throw new SelectionQaError("TOOL_ARGUMENTS_INVALID", 409, { field: "conclusion", constraint: "nonblank string, 1-1200 UTF-16 code units", length: typeof raw.conclusion === "string" ? raw.conclusion.length : null });
  const decision = { ...raw, selectedEvidenceIds } as unknown as QaResearchDecision;
  const unknownCount = decision.selectedEvidenceIds.filter(id => !evidence.has(id)).length;
  if (unknownCount) throw new SelectionQaError("EVIDENCE_INVALID", 409, { field: "informationNeeds.evidenceIds", constraint: "every evidence ID must belong to this turn's verified evidence", unknownCount });
  return decision;
}

export function projectDecisionEvidence(
  decision: QaResearchDecision,
  evidence: ReadonlyMap<string, QaSavedEvidence>,
  candidateIds: ReadonlySet<string>,
  maxCandidateChars: number,
): { decision: QaResearchDecision; omittedEvidenceIds: string[]; selectedCandidateChars: number } {
  const acceptedCandidates = new Set<string>();
  const omittedCandidates = new Set<string>();
  let selectedCandidateChars = 0;
  const informationNeeds = decision.informationNeeds.map(need => ({
    ...need,
    evidenceIds: need.evidenceIds.filter(id => {
      if (!candidateIds.has(id)) return true;
      if (acceptedCandidates.has(id)) return true;
      if (omittedCandidates.has(id)) return false;
      const item = evidence.get(id);
      if (!item) throw new SelectionQaError("EVIDENCE_INVALID", 409, { field: "informationNeeds.evidenceIds", constraint: "every evidence ID must belong to this turn's verified evidence", unknownCount: 1 });
      if (acceptedCandidates.size >= MAX_SELECTED_CANDIDATES || selectedCandidateChars + item.quote.length > maxCandidateChars) {
        omittedCandidates.add(id);
        return false;
      }
      acceptedCandidates.add(id);
      selectedCandidateChars += item.quote.length;
      return true;
    }),
  }));
  const selectedEvidenceIds: string[] = [];
  for (const need of informationNeeds)
    for (const id of need.evidenceIds)
      if (!selectedEvidenceIds.includes(id)) selectedEvidenceIds.push(id);
  return {
    decision: { ...decision, informationNeeds, selectedEvidenceIds },
    omittedEvidenceIds: [...omittedCandidates],
    selectedCandidateChars,
  };
}
