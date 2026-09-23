import { finishPlan } from "../../src/modules/ai-reading/selection-qa/application/selection-qa-decision.fixture";
import { SelectionQaError } from "../../src/modules/ai-reading/selection-qa/application/selection-qa.types";
import type {
  QaModelPort,
  QaModelInput,
  QaModelSnapshot,
  QaToolCall,
} from "../../src/modules/ai-reading/selection-qa/application/selection-qa-runtime.port";
import { QA_POLICY } from "../../src/modules/ai-reading/selection-qa/application/selection-qa-runtime.port";
export const cacheAnswer =
  "这是隔离模型的解释：缓存命中后可以减少对慢速源的重复读取。";
export const transferAnswer =
  "这是隔离模型的解释：转账的扣款与入账应当全部提交或全部撤销。";
const usage = { promptTokens: 20, completionTokens: 10, totalTokens: 30 };
export interface MockScenario {
  unconfigured?: boolean;
  plans?: QaToolCall[][];
  answer?: string;
  delayMs?: number;
  chunks?: string[];
  chunkDelayMs?: number;
  failAfterFirstDelta?: boolean;
  hold?: Promise<void>;
  fakeCitation?: boolean;
  onStream?: () => void;
}
/** Test-only provider. It cannot contact a model endpoint and contains no credentials. */
export class ScriptedQaModel implements QaModelPort {
  readonly calls: Array<{ kind: "complete" | "stream"; input: QaModelInput }> =
    [];
  scenario: MockScenario = {};
  private plan = 0;
  use(scenario: MockScenario = {}) {
    this.scenario = scenario;
    this.plan = 0;
    this.calls.length = 0;
  }
  snapshot(): QaModelSnapshot {
    if (this.scenario.unconfigured)
      throw new SelectionQaError("MODEL_NOT_CONFIGURED", 409);
    return {
      version: 1,
      providerId: "isolated-test-provider",
      modelId: "scripted-qa",
      configUpdatedAt: null,
      tokenizerId: "scripted-utf16-v1",
      contextWindowTokens: 64000,
      maxOutputTokens: 8192,
      policyVersion: QA_POLICY.version,
    };
  }
  count(_snapshot: QaModelSnapshot, text: string) {
    return Math.ceil(text.length / 4);
  }
  async complete(
    _user: number,
    _snapshot: QaModelSnapshot,
    input: QaModelInput,
  ) {
    input.signal.throwIfAborted();
    this.calls.push({ kind: "complete", input });
    const calls = this.scenario.plans?.[this.plan++] ?? [];
    return { toolCalls: calls.length ? calls : finishPlan(input), usage };
  }
  async stream(
    _user: number,
    _snapshot: QaModelSnapshot,
    input: QaModelInput,
    onDelta: (text: string) => Promise<void>,
  ) {
    this.calls.push({ kind: "stream", input });
    input.signal.throwIfAborted();
    for (const chunk of this.scenario.chunks ?? [this.scenario.answer ??
      (this.scenario.plans?.length ? transferAnswer : cacheAnswer)]) {
      await onDelta(chunk);
      if (this.scenario.chunkDelayMs) await abortable(new Promise<void>(r => setTimeout(r, this.scenario.chunkDelayMs)), input.signal);
    }
    this.scenario.onStream?.();
    if (this.scenario.failAfterFirstDelta)
      throw new Error("MOCK_PROVIDER_STREAM_FAILED");
    if (this.scenario.hold) await abortable(this.scenario.hold, input.signal);
    if (this.scenario.delayMs)
      await abortable(
        new Promise<void>((r) => setTimeout(r, this.scenario.delayMs)),
        input.signal,
      );
    const contents = input.messages.map((m) => m.content ?? "").join("\n");
    const ids = [...contents.matchAll(/"evidenceId"\s*:\s*"([^\"]+)"/g)].map(
      (match) => match[1],
    );
    const evidenceId = this.scenario.plans?.length
      ? ids[ids.length - 1]
      : ids[0];
    if (this.scenario.fakeCitation) await onDelta("[[evidence:forged-id]]");
    else if (evidenceId) await onDelta(`[[evidence:${evidenceId}]]`);
    input.signal.throwIfAborted();
    return { usage, finishReason: "stop" };
  }
}
async function abortable(promise: Promise<void>, signal: AbortSignal) {
  signal.throwIfAborted();
  let aborted: () => void = () => {};
  try {
    await Promise.race([
      promise,
      new Promise<never>((_r, reject) => {
        aborted = () => reject(signal.reason);
        signal.addEventListener("abort", aborted, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", aborted);
  }
}
export const searchPlan: QaToolCall = {
  id: "search-1",
  name: "search_book",
  arguments: JSON.stringify({
    informationNeed: "本书如何解释事务原子性",
    queries: { query1: "事务原子性 扣款 入账 全部撤销", query2: "", query3: "", query4: "" },
  }),
};
