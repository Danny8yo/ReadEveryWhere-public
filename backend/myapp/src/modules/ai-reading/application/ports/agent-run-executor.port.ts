import type { AgentRunLease, AgentRunRecordV2 } from './agent-run-store.port';

export interface AgentRunExecutionContext {
  run: AgentRunRecordV2;
  lease: AgentRunLease;
  signal: AbortSignal;
}

export interface AgentRunExecutorPort {
  execute(context: AgentRunExecutionContext): Promise<void>;
}

export interface ActiveAgentRunCancellationPort {
  abortTask(taskId: string): void;
}
