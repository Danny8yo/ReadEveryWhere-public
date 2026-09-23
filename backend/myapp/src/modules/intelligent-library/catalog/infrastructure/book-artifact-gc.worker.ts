import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { CollectBookArtifactsUseCase } from "../application/use-cases/collect-book-artifacts.use-case";

@Injectable()
export class BookArtifactGcWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookArtifactGcWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private destroying = false;

  constructor(private readonly collect: CollectBookArtifactsUseCase) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), 60 * 60 * 1000);
    this.timer.unref();
    void this.tick();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroying = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  async tick(): Promise<void> {
    if (this.running || this.destroying) return;
    this.running = true;
    try {
      const result = this.collect.execute({ workerId: "catalog-artifact-gc", limit: 100 });
      if (result.failed > 0) this.logger.warn({ event: "catalog.artifact_gc.cleanup_failed", ...result });
    } catch (error) {
      if (isSqliteBusy(error)) {
        this.logger.warn({ event: "catalog.artifact_gc.sqlite_busy", errorCode: "SQLITE_BUSY" });
      } else {
        this.logger.error(error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.running = false;
    }
  }
}

function isSqliteBusy(error: unknown): boolean {
  return error instanceof Error && ("code" in error) && (error as Error & { code?: string }).code === "SQLITE_BUSY";
}
