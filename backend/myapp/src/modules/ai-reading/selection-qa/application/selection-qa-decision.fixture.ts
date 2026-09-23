import type { QaModelInput, QaToolCall } from "./selection-qa-runtime.port";
import { MAX_SELECTED_CANDIDATES } from "./selection-qa-decision";
/** Scripted test decision; never used by production execution. */
export function finishPlan(input: Pick<QaModelInput, "messages">): QaToolCall[] {
  const envelope = JSON.parse(input.messages[input.messages.length - 1].content!);
  const candidates = new Set<string>(envelope.researchBudget.candidateIds);
  let remaining = envelope.researchBudget.maxSelectedCandidateChars, count = 0;
  const selected = envelope.VERIFIED_EVIDENCE.filter((e: { evidenceId: string; quote: string }) => {
    if (count >= Math.min(8, MAX_SELECTED_CANDIDATES)) return false;
    if (candidates.has(e.evidenceId) && e.quote.length > remaining) return false;
    count++;
    if (candidates.has(e.evidenceId)) remaining -= e.quote.length;
    return true;
  });
  return [{ id: "finish", name: "finish_research", arguments: JSON.stringify({
    informationNeeds: selected.length
      ? selected.map((e: { evidenceId: string }, index: number) => ({ text: `解释选文中的概念（证据${index + 1}）`, targetSource: "current_book", sourceName: "", evidenceIds: [e.evidenceId] }))
      : [{ text: "解释当前问题", targetSource: "model_knowledge", sourceName: "", evidenceIds: [] }],
    externalEvidenceNeeded: [], insufficientEvidence: [], conclusion: "现有证据足够，结束查阅",
  }) }];
}
