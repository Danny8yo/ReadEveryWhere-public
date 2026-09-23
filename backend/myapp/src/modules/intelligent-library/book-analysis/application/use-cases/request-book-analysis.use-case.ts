import { extname } from "node:path";
import { BookAnalysisError } from "../../domain/book-analysis.error";
import { BookAnalysisTask } from "../../domain/book-analysis-task";
import type { BookAnalysisContentPort } from "../ports/book-analysis-content.port";
import type { BookAnalysisLibraryPort } from "../ports/book-analysis-library.port";
import type { BookAnalysisModelConfigPort } from "../ports/book-analysis-model-config.port";
import type { BookAnalysisModelCapabilityPort } from "../ports/book-analysis-model-capability.port";
import type { BookAnalysisStorePort } from "../ports/book-analysis-store.port";

export class RequestBookAnalysisUseCase {
  constructor(
    private readonly books: BookAnalysisLibraryPort,
    private readonly content: Pick<BookAnalysisContentPort, "currentRevision">,
    private readonly modelConfigs: BookAnalysisModelConfigPort,
    private readonly store: Pick<BookAnalysisStorePort, "getSnapshot" | "enqueueIfAbsent">,
    private readonly options: { strategyVersion: string },
    private readonly modelCapabilities: BookAnalysisModelCapabilityPort,
    private readonly runtime = {
      idFactory: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    },
  ) {}

  async execute(userId: number, input: { bookId: number; force: boolean }) {
    const source = this.books.findOwnedAnalysisSource(userId, input.bookId);
    if (!source) throw BookAnalysisError.rejected("BOOK_NOT_FOUND", "Book not found");
    if (!source.fileName || source.downloadStatus && source.downloadStatus !== "completed") {
      throw BookAnalysisError.rejected("BOOK_FILE_MISSING", "Book file is unavailable");
    }
    if (source.mimeType !== "application/epub+zip"
      && extname(source.fileName).toLowerCase() !== ".epub") {
      throw BookAnalysisError.rejected("UNSUPPORTED_FORMAT", "Only EPUB can be analyzed");
    }
    const credential = this.modelConfigs.getCredential(userId);
    if (!credential) {
      throw BookAnalysisError.rejected("AI_MODEL_NOT_CONFIGURED", "AI model is not configured");
    }
    if (!this.modelCapabilities.supportsStrictTools(credential)) {
      throw BookAnalysisError.rejected("AI_MODEL_UNSUPPORTED", "Reasoning models are not supported for book analysis");
    }

    const revision = await this.content.currentRevision(userId, input.bookId);
    const snapshot = this.store.getSnapshot(
      userId,
      input.bookId,
      revision,
      this.options.strategyVersion,
    );
    if (!input.force && snapshot.status === "ready" && !snapshot.stale) {
      return result(input.bookId, "skipped", "ready", null, "ANALYSIS_CURRENT");
    }

    const task = BookAnalysisTask.create({
      id: this.runtime.idFactory(),
      userId,
      bookId: input.bookId,
      contentRevision: revision,
      modelId: credential.modelId,
      strategyVersion: this.options.strategyVersion,
      requestedAt: this.runtime.now(),
    });
    const queued = this.store.enqueueIfAbsent(task);
    return queued.created
      ? result(input.bookId, "accepted", queued.task.status, queued.task.id, null)
      : result(input.bookId, "skipped", queued.task.status, queued.task.id, "ALREADY_QUEUED");
  }
}

function result(
  bookId: number,
  disposition: "accepted" | "skipped",
  status: string,
  taskId: string | null,
  reason: string | null,
) {
  return { bookId, disposition, status, taskId, reason };
}
