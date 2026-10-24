/** Resource boundaries, never a prescribed reading route. */
export const QA_POLICY = Object.freeze({
  version: "selection-qa-p1",
  maxModelCalls: 40,
  maxToolCalls: 60,
  maxReadChars: 500000,
  deadlineMs: 1200000,
  finalReserveMs: 180000,
  maxAnswerVersions: 3,
  maxAnswerChars: 64000,
  planningOutputTokens: 3072,
  answerOutputTokens: 8192,
  leaseMs: 10000,
});

/** A third identical observation is not a new lead; different actions remain available. */
export class QaProgressGuard {
  private readonly observations = new Map<string, { value: string; repeats: number }>();
  blocked(action: string): boolean { return (this.observations.get(action)?.repeats ?? 0) >= 2; }
  observe(action: string, value: string): void {
    const prior = this.observations.get(action);
    this.observations.set(action, { value, repeats: prior?.value === value ? prior.repeats + 1 : 1 });
  }
}
