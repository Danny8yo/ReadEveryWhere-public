import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AgentRunLease, AgentRunRecordV2, AgentRunStorePort } from '../application/ports/agent-run-store.port';
import type {
  ActiveAgentRunCancellationPort,
  AgentRunExecutionContext,
  AgentRunExecutorPort,
} from '../application/ports/agent-run-executor.port';

@Injectable()
export class AiReadingScheduler implements OnModuleInit, OnModuleDestroy, ActiveAgentRunCancellationPort {
  private readonly logger = new Logger(AiReadingScheduler.name);
  private readonly workerId = `agent-worker-${randomUUID()}`;
  private readonly active = new Map<string, { taskId: string; controller: AbortController; promise: Promise<void> }>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private destroyed = false;

  constructor(
    private readonly runs: AgentRunStorePort,
    private readonly executor: AgentRunExecutorPort,
    private readonly options: { maxConcurrentRuns: number },
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), 500);
    this.timer.unref();
    void this.tick();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const value of this.active.values()) value.controller.abort();
    await Promise.all([...this.active.values()].map(value => value.promise));
  }

  async tick(): Promise<void> {
    if (this.ticking || this.destroyed) return;
    this.ticking = true;
    try {
      const now = new Date().toISOString();
      this.runs.resumeReadyParents(now);
      while (this.active.size < this.options.maxConcurrentRuns) {
        const claimed = this.runs.claimNext(
          this.workerId,
          new Date().toISOString(),
          this.options.maxConcurrentRuns,
          [...this.active.keys()],
        );
        if (!claimed || this.active.has(claimed.run.id)) break;
        this.startClaim(claimed);
      }
    } catch (error) {
      if (!isSqliteBusy(error)) throw error;
      this.logger.warn({
        event: 'ai_reading.scheduler.sqlite_busy',
        errorCode: 'SQLITE_BUSY',
      });
    } finally {
      this.ticking = false;
    }
  }

  abortTask(taskId: string): void {
    for (const value of this.active.values()) {
      if (value.taskId === taskId) value.controller.abort();
    }
  }

  private startClaim(claimed: { run: AgentRunRecordV2; lease: AgentRunLease }): void {
    const controller = new AbortController();
    let lease = claimed.lease;
    const executionContext: AgentRunExecutionContext = { run: claimed.run, lease, signal: controller.signal };
    const renewal = setInterval(() => {
      if (controller.signal.aborted) return;
      const renewed = this.runs.renewLease(lease, new Date().toISOString());
      if (renewed) {
        lease = renewed;
        executionContext.lease = renewed;
        return;
      }
      controller.abort();
    }, 30_000);
    renewal.unref();

    // Register the task before executing, including executors that throw synchronously.
    const promise = Promise.resolve()
      .then(() => {
        if (!controller.signal.aborted) return this.executor.execute(executionContext);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        this.logger.error({
          event: 'ai_reading.agent_run.failed',
          agentRunId: claimed.run.id,
          taskId: claimed.run.taskId,
          errorCode: errorCodeOf(error),
        });
      })
      .finally(() => {
        clearInterval(renewal);
        this.active.delete(claimed.run.id);
        queueMicrotask(() => void this.tick());
      });
    this.active.set(claimed.run.id, { taskId: claimed.run.taskId, controller, promise });
  }
}

function errorCodeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'AGENT_RUN_EXECUTION_FAILED';
}

function isSqliteBusy(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; errcode?: unknown; errstr?: unknown; message?: unknown };
  return value.code === 'SQLITE_BUSY'
    || value.errcode === 5
    || value.errstr === 'database is locked'
    || value.message === 'database is locked';
}
