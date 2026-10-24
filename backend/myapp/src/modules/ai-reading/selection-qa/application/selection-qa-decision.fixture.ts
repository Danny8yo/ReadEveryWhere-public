import type { QaModelInput, QaToolCall, QaModelPort } from "./selection-qa-runtime.port";
/** Old action-specific tests get a separately scripted checker; this does not test semantic detection. */
export function passingQualityFixture(model: QaModelPort, onCheck = () => {}): QaModelPort {
  return new Proxy(model, { get(target, key) {
    if (key !== "complete") return Reflect.get(target, key);
    return async (...args: Parameters<QaModelPort["complete"]>) => {
      if (args[2].tools?.some(t => t.function.name === "assess_answer")) {
        onCheck();
        return { usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 }, toolCalls: [{ id: "check", name: "assess_answer", arguments: '{"verdict":"pass","issues":[]}' }] };
      }
      return target.complete(...args);
    };
  } });
}
/** Scripted test decision; never used by production execution. */
export function finishPlan(input: Pick<QaModelInput, "messages">): QaToolCall[] {
  const envelope = JSON.parse(input.messages[input.messages.length - 1].content!);
  const selected = envelope.VERIFIED_EVIDENCE.slice(0, 8);
  return [{ id: "finish", name: "finish_research", arguments: JSON.stringify({
    informationNeeds: selected.length
      ? selected.map((e: { evidenceId: string }, index: number) => ({ text: `解释选文中的概念（证据${index + 1}）`, targetSource: "current_book", sourceName: "", evidenceIds: [e.evidenceId] }))
      : [{ text: "解释当前问题", targetSource: "model_knowledge", sourceName: "", evidenceIds: [] }],
    externalEvidenceNeeded: [], insufficientEvidence: [], conclusion: "现有证据足够，结束查阅",
  }) }];
}
