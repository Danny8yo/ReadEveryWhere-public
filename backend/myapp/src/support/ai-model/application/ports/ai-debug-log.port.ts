export interface AiDebugTraceContext {
  component: "ai-reading" | "book-analysis" | "model-config-test" | "metadata-enrichment";
  requestId?: string;
  taskId?: string;
  agentRunId?: string;
  modelCallId?: string;
  stepId?: string;
  toolCallId?: string;
}

export interface AiDebugLogInput {
  event: string;
  trace?: AiDebugTraceContext;
  data?: unknown;
  secrets?: readonly string[];
}

export interface AiDebugLogPort {
  write(input: AiDebugLogInput): void;
}

export const NOOP_AI_DEBUG_LOG: AiDebugLogPort = Object.freeze({
  write: () => undefined,
});
