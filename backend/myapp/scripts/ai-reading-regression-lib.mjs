export function matchesRequestedBook(metadata, titleIncludes) {
  const title = metadata?.book?.title;
  return typeof title === "string" && title.includes(titleIncludes);
}

export function selectReferencedEvidence(evidence, referencedIds) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  return referencedIds.map((id) => evidenceById.get(id)).filter(Boolean);
}

export function regressionErrorCode(task, failureEvent) {
  const rootReason = task?.agents?.find((agent) => agent.kind === "root")?.terminalReason;
  return rootReason
    ?? failureEvent?.payload?.errorCode
    ?? failureEvent?.payload?.reason
    ?? null;
}

export function isRegressionCasePassing(result) {
  return result?.finalStatus === "completed"
    && result?.citationValidity?.valid === true;
}

export function isResumableRegressionCase(result) {
  return (result?.finalStatus === "queued" || result?.finalStatus === "running")
    && typeof result?.conversationId === "string"
    && typeof result?.turnId === "string"
    && typeof result?.taskId === "string";
}

export function retryAfterMs(headerValue, fallbackMs = 600_000) {
  const seconds = Number(headerValue);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds * 1_000)
    : fallbackMs;
}

export function authenticationIsFresh(authenticatedAt, now = Date.now(), maxAgeMs = 12 * 60_000) {
  return Number.isFinite(authenticatedAt)
    && authenticatedAt > 0
    && now - authenticatedAt < maxAgeMs;
}
