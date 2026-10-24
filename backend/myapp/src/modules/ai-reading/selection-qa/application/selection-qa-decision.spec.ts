import { finishResearchToolFor, MAX_INFORMATION_NEEDS, parseDecision } from "./selection-qa-decision";
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

  it("preserves selected evidence across needs without an implicit expansion projection", () => {
    const passages = new Map(Array.from({ length: 16 }, (_, index) => [`e_${index}`, { evidenceId: `e_${index}` } as QaSavedEvidence]));
    const parsed = parseDecision(decision([
      need("current_book", Array.from({ length: 8 }, (_, index) => `e_${index}`)),
      need("current_book", Array.from({ length: 8 }, (_, index) => `e_${index + 8}`)),
    ]), passages);
    expect(parsed.selectedEvidenceIds).toEqual([...passages.keys()]);
    expect(parsed.informationNeeds[1].evidenceIds).toEqual([...passages.keys()].slice(8));
  });
  it("enforces each need's declared evidence-array bound", () => {
    const ids = Array.from({ length: 13 }, (_, i) => `e_${i}`);
    const passages = new Map(ids.map(id => [id, { evidenceId: id } as QaSavedEvidence]));
    expect(() => parseDecision(decision([need("current_book", ids)]), passages))
      .toThrow(expect.objectContaining({ code: "TOOL_ARGUMENTS_INVALID" }));
  });

  it("bounds the number of semantic needs independently from evidence budgeting", () => {
    const tooMany = Array.from({ length: MAX_INFORMATION_NEEDS + 1 }, () => need("model_knowledge"));
    expect(() => parseDecision(decision(tooMany), owned)).toThrow(expect.objectContaining({ code: "TOOL_ARGUMENTS_INVALID" }));
  });

  it("identifies the exact oversized need field so the model can repair it", () => {
    expect(() => parseDecision(decision([
      need("model_knowledge"), { ...need("model_knowledge"), text: "长".repeat(230) },
    ]), owned)).toThrow(expect.objectContaining({ code: "TOOL_ARGUMENTS_INVALID", current: {
      field: "informationNeeds[1].text", constraint: "length", actual: 230, minimum: 1, maximum: 200,
    } }));
  });

  it.each([
    ["invalid target", [need("another_source")], "TOOL_ARGUMENTS_INVALID"],
    ["external book cites current book", [need("other_book_unverified", ["e_current"], "高性能MySQL")], "TOOL_ARGUMENTS_INVALID"],
    ["model knowledge cites book", [need("model_knowledge", ["e_current"])], "TOOL_ARGUMENTS_INVALID"],
    ["external book lacks name", [need("other_book_unverified")], "TOOL_ARGUMENTS_INVALID"],
    ["duplicate IDs", [need("current_book", ["e_current", "e_current"])], "TOOL_ARGUMENTS_INVALID"],
    ["foreign ID", [need("current_book", ["e_foreign"])], "EVIDENCE_INVALID"],
    ["foreign ID hidden behind a wrong source target", [need("model_knowledge", ["e_foreign"])], "EVIDENCE_INVALID"],
  ])("rejects %s", (_label, needs, code) => {
    expect(() => parseDecision(decision(needs), owned)).toThrow(expect.objectContaining({ code }));
  });
});
