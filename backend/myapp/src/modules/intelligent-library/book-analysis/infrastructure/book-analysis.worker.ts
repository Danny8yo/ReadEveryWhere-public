import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { BookAnalysisStorePort, ClaimedBookAnalysisTask } from "../application/ports/book-analysis-store.port";
import { ClassifyBookUseCase } from "../application/use-cases/classify-book.use-case";

@Injectable()
export class BookAnalysisWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookAnalysisWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private destroying = false;
  private readonly workerId: string;

  constructor(
    private readonly store: BookAnalysisStorePort,
    private readonly classifyBook: ClassifyBookUseCase,
    private readonly options: {
      concurrency: number;
      leaseMs: number;
      workerId?: string;
      pollMs?: number;
    } = { concurrency: 2, leaseMs: 60_000 },
  ) {
    this.workerId = options.workerId ?? `book-analysis-${randomUUID()}`;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), this.options.pollMs ?? 1_000);
    this.timer.unref();
    void this.tick();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroying = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.ticking) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      while (true) {
        if (this.destroying) return;
        const claims: ClaimedBookAnalysisTask[] = [];
        while (claims.length < Math.max(1, this.options.concurrency)) {
          const claimed = this.store.claimNext(
            this.workerId,
            new Date().toISOString(),
            this.options.leaseMs,
          );
          if (!claimed) break;
          claims.push(claimed);
        }
        if (claims.length === 0) return;
        await Promise.all(claims.map((claim) => this.process(claim)));
        if (this.destroying) return;
      }
    } catch (error) {
      if (!isSqliteBusy(error)) throw error;
      this.logger.warn({
        event: "book_analysis.worker.sqlite_busy",
        errorCode: "SQLITE_BUSY",
      });
    } finally {
      this.ticking = false;
    }
  }

  private async process(claim: ClaimedBookAnalysisTask): Promise<void> {
    try {
      const profile = await this.classifyBook.execute({
        userId: claim.task.userId,
        bookId: claim.task.bookId,
      });
      this.store.complete({
        taskId: claim.task.id,
        profileId: profile.id,
        lease: claim.lease,
        now: new Date().toISOString(),
      });
    } catch (error) {
      this.store.fail({
        taskId: claim.task.id,
        errorCode: errorCode(error),
        lease: claim.lease,
        now: new Date().toISOString(),
      });
    } finally {
      this.store.releaseLease(claim.lease);
    }
  }
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error
    && typeof error.code === "string") return error.code;
  return "ANALYSIS_WORKER_FAILED";
}

function isSqliteBusy(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; errcode?: unknown; errstr?: unknown; message?: unknown };
  return value.code === "SQLITE_BUSY"
    || value.errcode === 5
    || value.errstr === "database is locked"
    || value.message === "database is locked";
}
