import { finishResearchToolFor, MAX_INFORMATION_NEEDS, parseDecision, projectDecisionEvidence } from "./selection-qa-decision";
import type { QaSavedEvidence } from "./selection-qa-runtime.port";

const owned = new Map([["e_current", { evidenceId: "e_current" } as QaSavedEvidence]]);
const need = (targetSource: string, evidenceIds: string[] = [], sourceName = "") => ({ text: "解释索引名称", targetSource, sourceName, evidenceIds });
const decision = (informationNeeds: unknown) => ({ informationNeeds, externalEvidenceNeeded: [], insufficientEvidence: [], conclusion: "结束查阅" });

describe("selection QA source-targeted research decision", () => {
  it("lists only this turn's verified IDs in the tool schema", () => {
    const tool = finishResearchToolFor(["e_current"]);
    const schema = tool.function.parameters as any;
    expect(schema.properties.informationNeeds.items.properties.evidenceIds.items.enum).toEqual(["e_current"]);
    expect((finishResearchToolFor([]).function.parameters as any).properties.informationNeeds.items.properties.evidenceIds.items.enum).toBeUndefined();
  });
  it("derives the selected set solely from current-book needs", () => {
    const parsed = parseDecision(decision([
      need("current_book", ["e_current"]),
      need("model_knowledge"),
      need("other_book_unverified", [], "高性能MySQL"),
    ]), owned);
    expect(parsed.selectedEvidenceIds).toEqual(["e_current"]);
    expect(parsed.informationNeeds[2]).toMatchObject({ targetSource: "other_book_unverified", evidenceIds: [] });
  });

  it("accepts broad needs and deterministically projects their shared evidence budget", () => {
    const passages = new Map(Array.from({ length: 16 }, (_, index) => [`e_${index}`, { evidenceId: `e_${index}` } as QaSavedEvidence]));
    expect(parseDecision(decision([need("current_book", ["e_0", "e_1"])]), passages).selectedEvidenceIds).toEqual(["e_0", "e_1"]);
    const parsed = parseDecision(decision([
      need("current_book", Array.from({ length: 8 }, (_, index) => `e_${index}`)),
      need("current_book", Array.from({ length: 8 }, (_, index) => `e_${index + 8}`)),
    ]), passages);
    const withQuotes = new Map([...passages].map(([id, item]) => [id, { ...item, quote: id } as QaSavedEvidence]));
    const projected = projectDecisionEvidence(parsed, withQuotes, new Set(passages.keys()), 10_000);
    expect(projected.decision.selectedEvidenceIds).toEqual(Array.from({ length: 12 }, (_, index) => `e_${index}`));
    expect(projected.omittedEvidenceIds).toEqual(["e_12", "e_13", "e_14", "e_15"]);
    expect(projected.decision.informationNeeds[1].evidenceIds).toEqual(["e_8", "e_9", "e_10", "e_11"]);
  });

  it("keeps initial context outside the retrieved-candidate count and enforces the character budget", () => {
    const passages = new Map([
      ["selection", { evidenceId: "selection", quote: "选文" } as QaSavedEvidence],
      ["long", { evidenceId: "long", quote: "123456" } as QaSavedEvidence],
      ["short", { evidenceId: "short", quote: "1234" } as QaSavedEvidence],
    ]);
    const parsed = parseDecision(decision([need("current_book", ["selection", "long", "short"])]), passages);
    const projected = projectDecisionEvidence(parsed, passages, new Set(["long", "short"]), 4);
    expect(projected.decision.selectedEvidenceIds).toEqual(["selection", "short"]);
    expect(projected.omittedEvidenceIds).toEqual(["long"]);
    expect(projected.selectedCandidateChars).toBe(4);
  });

  it("bounds the number of semantic needs independently from evidence budgeting", () => {
    const tooMany = Array.from({ length: MAX_INFORMATION_NEEDS + 1 }, () => need("model_knowledge"));
    expect(() => parseDecision(decision(tooMany), owned)).toThrow(expect.objectContaining({ code: "TOOL_ARGUMENTS_INVALID" }));
  });

  it.each([
    ["invalid target", [need("another_source")], "TOOL_ARGUMENTS_INVALID"],
    ["external book cites current book", [need("other_book_unverified", ["e_current"], "高性能MySQL")], "TOOL_ARGUMENTS_INVALID"],
    ["model knowledge cites book", [need("model_knowledge", ["e_current"])], "TOOL_ARGUMENTS_INVALID"],
    ["external book lacks name", [need("other_book_unverified")], "TOOL_ARGUMENTS_INVALID"],
    ["duplicate IDs", [need("current_book", ["e_current", "e_current"])], "TOOL_ARGUMENTS_INVALID"],
    ["foreign ID", [need("current_book", ["e_foreign"])], "EVIDENCE_INVALID"],
  ])("rejects %s", (_label, needs, code) => {
    expect(() => parseDecision(decision(needs), owned)).toThrow(expect.objectContaining({ code }));
  });
});
