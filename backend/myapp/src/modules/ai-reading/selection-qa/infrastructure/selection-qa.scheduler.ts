import {
  Logger,
  OnModuleInit,
  BeforeApplicationShutdown,
  OnModuleDestroy,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  QaRuntimeStore,
  QaClaim,
} from "../application/selection-qa-runtime.port";
import { SelectionQaExecutor } from "../application/selection-qa.executor";
export class SelectionQaScheduler
  implements OnModuleInit, BeforeApplicationShutdown, OnModuleDestroy
{
  private readonly logger = new Logger(SelectionQaScheduler.name);
  private readonly owner = randomUUID();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly running = new Map<
    string,
    { claim: QaClaim; controller: AbortController; promise: Promise<void> }
  >();
  constructor(
    private readonly store: QaRuntimeStore,
    private readonly executor: SelectionQaExecutor,
  ) {}
  onModuleInit() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 250);
    this.timer.unref();
  }
  private tick() {
    if (this.stopped) return;
    try {
      this.store.maintain(Date.now());
      for (const active of this.running.values()) {
        try {
          this.store.renew(active.claim, Date.now());
        } catch (error) {
          active.controller.abort(
            error instanceof Error ? error.message : "LEASE_LOST",
          );
        }
      }
      while (this.running.size < 2) {
        const claim = this.store.claim(this.owner, Date.now());
        if (!claim) break;
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort("DEADLINE_EXCEEDED"),
          Math.max(1, claim.turn.deadline - Date.now()),
        );
        const promise = this.executor
          .run(claim, controller.signal)
          .catch((error) => {
            this.logger.error(
              {
                turnId: claim.turn.id,
                error: error instanceof Error ? error.stack : String(error),
              },
              "QA execution failed",
            );
          })
          .finally(() => {
            clearTimeout(timeout);
            this.running.delete(claim.turn.id);
          });
        this.running.set(claim.turn.id, { claim, controller, promise });
      }
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.stack : String(error) },
        "QA scheduler failed",
      );
    }
  }
  async onModuleDestroy() {
    await this.beforeApplicationShutdown();
  }
  async beforeApplicationShutdown() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    const active = [...this.running.values()];
    for (const item of active) item.controller.abort("worker_interrupted");
    await Promise.allSettled(active.map((item) => item.promise));
  }
}
