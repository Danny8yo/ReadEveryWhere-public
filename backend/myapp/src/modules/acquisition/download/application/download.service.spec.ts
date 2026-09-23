import type {
  AttachBookFilePort,
  BookFileStatusQueryPort,
  BookOwnershipPort,
  BookSourceReferenceQueryPort,
} from "../../../intelligent-library/public";
import { AcquisitionError } from "../../domain/acquisition.error";
import type { DownloadSourcePort } from "../../public";
import { SourceRegistry } from "../../source-registry/application/source-registry";
import type {
  CreateDownloadTaskInput,
  DownloadTask,
  DownloadTaskStatus,
} from "../domain/download.types";
import { DownloadService } from "./download.service";
import type { DownloadTaskRepositoryPort } from "./ports/download-task-repository.port";

const command = {
  bookId: 41,
  sourcePlatform: "zlibrary" as const,
  sourceUrl: "/dl/source-41",
  fileName: "requested.epub",
};

describe("DownloadService", () => {
  it("checks ownership before creating a task", async () => {
    const context = createContext({ owned: false });

    await expect(context.service.createTask(7, command)).rejects.toMatchObject<Partial<AcquisitionError>>({
      kind: "NOT_FOUND",
      field: "bookId",
      message: "Book not found",
    });
    expect(context.tasks.all()).toHaveLength(0);
    expect(context.sourceReferences.findForDownload).not.toHaveBeenCalled();
  });

  it("requires a Catalog source reference before creating a task", async () => {
    const context = createContext({ sourceReference: null });

    await expect(context.service.createTask(7, command)).rejects.toMatchObject<Partial<AcquisitionError>>({
      kind: "VALIDATION",
      field: "bookId",
    });
    expect(context.tasks.all()).toHaveLength(0);
    expect(context.files.findExisting).not.toHaveBeenCalled();
  });

  it("completes from an existing Catalog file without invoking a source adapter", async () => {
    const context = createContext({
      existingFile: { absolutePath: __filename, storedPath: "books/41/existing.epub" },
    });

    const result = await context.service.createTask(7, command);

    expect(result).toMatchObject({
      status: "completed",
      progress: 100,
      localPath: "books/41/existing.epub",
    });
    expect(context.download.download).not.toHaveBeenCalled();
    expect(context.fileDelivery.attach).not.toHaveBeenCalled();
  });

  it("delivers a successful artifact through AttachBookFilePort", async () => {
    const context = createContext();
    context.download.download.mockResolvedValue({
      content: Buffer.from("downloaded fixture"),
      localPath: "/tmp/acquisition-41.epub",
      fileName: "downloaded.epub",
      fileSize: 2048,
      mimeType: "application/epub+zip",
      checksum: "a".repeat(64),
    });

    const queued = await context.service.createTask(7, command);
    await eventually(() => context.tasks.findTaskById(queued.id)?.status === "completed");

    expect(context.download.download).toHaveBeenCalledWith(
      "/dl/source-41",
      expect.objectContaining({
        userId: 7,
        bookId: 41,
        requestedFileName: "requested.epub",
        sourceBookId: "source-41",
        hash: "hash-41",
      }),
    );
    expect(context.fileDelivery.attach).toHaveBeenCalledWith({
      userId: 7,
      bookId: 41,
      sourcePlatform: "zlibrary",
      sourceUrl: "/dl/source-41",
      content: expect.any(Buffer),
      localPath: "/tmp/acquisition-41.epub",
      fileName: "downloaded.epub",
      mimeType: "application/epub+zip",
      fileSize: 2048,
      checksum: "a".repeat(64),
    });
    expect(context.tasks.findTaskById(queued.id)).toMatchObject({
      status: "completed",
      progress: 100,
      localPath: "/tmp/acquisition-41.epub",
    });
  });

  it("records a failed task without attempting Catalog file delivery", async () => {
    const context = createContext();
    context.download.download.mockRejectedValue(new Error("upstream unavailable"));

    const queued = await context.service.createTask(7, command);
    await eventually(() => context.tasks.findTaskById(queued.id)?.status === "failed");

    expect(context.fileDelivery.attach).not.toHaveBeenCalled();
    expect(context.tasks.findTaskById(queued.id)).toMatchObject({
      status: "failed",
      errorMessage: "Download failed",
      localPath: null,
    });
  });

  it("records attach failure without leaving a Catalog file", async () => {
    const context = createContext();
    context.download.download.mockResolvedValue(artifact());
    context.fileDelivery.attach.mockImplementation(() => {
      throw new Error("attach failed");
    });

    const queued = await context.service.createTask(7, command);
    await eventually(() => context.tasks.findTaskById(queued.id)?.status === "failed");

    expect(context.fileDelivery.detach).not.toHaveBeenCalled();
    expect(context.tasks.findTaskById(queued.id)).toMatchObject({
      status: "failed",
      errorMessage: "Download failed",
      localPath: null,
    });
  });

  it("keeps the Catalog attachment when marking the task projection completed fails", async () => {
    const context = createContext({ failMarkCompleted: true });
    context.download.download.mockResolvedValue(artifact());

    const queued = await context.service.createTask(7, command);
    await eventually(() => context.tasks.findTaskById(queued.id)?.status === "failed");

    expect(context.fileDelivery.attach).toHaveBeenCalledTimes(1);
    expect(context.fileDelivery.detach).not.toHaveBeenCalled();
    expect(context.tasks.findTaskById(queued.id)).toMatchObject({
      status: "failed",
      localPath: null,
    });
  });

  it("does not invoke attachment cleanup after a task projection failure", async () => {
    const context = createContext({ failMarkCompleted: true });
    context.download.download.mockResolvedValue(artifact());
    context.fileDelivery.detach.mockImplementation(() => {
      throw new Error("cleanup failed");
    });

    const queued = await context.service.createTask(7, command);
    await eventually(() => context.tasks.findTaskById(queued.id)?.status === "failed");

    expect(context.tasks.findTaskById(queued.id)).toMatchObject({
      status: "failed",
      errorMessage: "Download failed",
    });
    expect(context.fileDelivery.detach).not.toHaveBeenCalled();
  });

  it("keeps a delivered task completed and records a visible warning when source accounting fails", async () => {
    const context = createContext();
    context.download.download.mockResolvedValue(artifact());
    context.recordCompleted.mockRejectedValue(new Error("quota write failed"));

    const queued = await context.service.createTask(7, command);
    await eventually(() => context.tasks.findTaskById(queued.id)?.errorMessage !== null);

    expect(context.fileDelivery.attach).toHaveBeenCalledTimes(1);
    expect(context.fileDelivery.detach).not.toHaveBeenCalled();
    expect(context.tasks.findTaskById(queued.id)).toMatchObject({
      status: "completed",
      progress: 100,
      errorMessage: "Source completion accounting failed",
    });
  });

  it("does not attach a late artifact after cancellation wins during download", async () => {
    const context = createContext();
    let resolveDownload!: (value: ReturnType<typeof artifact>) => void;
    context.download.download.mockReturnValue(new Promise((resolve) => {
      resolveDownload = resolve;
    }));

    const queued = await context.service.createTask(7, command);
    await eventually(() => context.tasks.findTaskById(queued.id)?.status === "downloading");
    expect(context.service.cancelTask(7, queued.id)).toEqual({ canceled: true });
    resolveDownload(artifact());
    await eventually(() => context.download.download.mock.results[0]?.value !== undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(context.tasks.findTaskById(queued.id)?.status).toBe("canceled");
    expect(context.fileDelivery.attach).not.toHaveBeenCalled();
  });

  it("removes an attachment when cancellation occurs during synchronous delivery", async () => {
    const context = createContext();
    context.download.download.mockResolvedValue(artifact());
    context.fileDelivery.attach.mockImplementation(() => {
      expect(context.service.cancelTask(7, 1)).toEqual({ canceled: true });
      return {
        deliveryId: "delivery-1",
        artifactId: "artifact-1",
        localPath: "/tmp/acquisition-41.epub",
        storedPath: "/tmp/acquisition-41.epub",
        checksum: "a".repeat(64),
      };
    });

    const queued = await context.service.createTask(7, command);
    await eventually(() => context.fileDelivery.detach.mock.calls.length === 1);

    expect(context.tasks.findTaskById(queued.id)?.status).toBe("canceled");
    expect(context.fileDelivery.detach).toHaveBeenCalledWith({
      userId: 7,
      bookId: 41,
      localPath: "/tmp/acquisition-41.epub",
      checksum: "a".repeat(64),
    });
  });
});

function createContext(options: {
  owned?: boolean;
  sourceReference?: { sourceBookId: string; hash: string | null } | null;
  existingFile?: { absolutePath: string; storedPath: string } | null;
  failMarkCompleted?: boolean;
} = {}) {
  const tasks = new InMemoryDownloadTasks(options.failMarkCompleted ?? false);
  const recordCompleted = jest.fn<Promise<void>, [number]>().mockResolvedValue(undefined);
  const download: jest.Mocked<DownloadSourcePort> = {
    platform: "zlibrary",
    download: jest.fn(),
    recordCompleted,
  };
  const ownership: jest.Mocked<BookOwnershipPort> = {
    isOwnedByUser: jest.fn().mockReturnValue(options.owned ?? true),
  };
  const sourceReferences: jest.Mocked<BookSourceReferenceQueryPort> = {
    findForDownload: jest.fn().mockReturnValue(
      options.sourceReference === undefined
        ? { sourceBookId: "source-41", hash: "hash-41" }
        : options.sourceReference,
    ),
  };
  const files: jest.Mocked<BookFileStatusQueryPort> = {
    findExisting: jest.fn().mockReturnValue(options.existingFile ?? null),
  };
  const fileDelivery = {
    attach: jest.fn().mockReturnValue({
      deliveryId: "delivery-1",
      artifactId: "artifact-1",
      localPath: "/tmp/acquisition-41.epub",
      storedPath: "/tmp/acquisition-41.epub",
      checksum: "a".repeat(64),
    }),
    detach: jest.fn(),
  };
  return {
    tasks,
    download,
    recordCompleted,
    ownership,
    sourceReferences,
    files,
    fileDelivery,
    service: new DownloadService(
      tasks,
      new SourceRegistry([], [download]),
      ownership,
      sourceReferences,
      files,
      fileDelivery,
    ),
  };
}

class InMemoryDownloadTasks implements DownloadTaskRepositoryPort {
  private readonly tasks = new Map<number, DownloadTask>();
  private nextId = 1;

  constructor(private readonly failMarkCompleted: boolean) {}

  createTask(input: Readonly<CreateDownloadTaskInput>): DownloadTask {
    const now = new Date().toISOString();
    const task: DownloadTask = {
      id: this.nextId++,
      ...input,
      status: "queued",
      progress: 0,
      localPath: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    return { ...task };
  }

  findTaskByIdForUser(userId: number, taskId: number): DownloadTask | null {
    const task = this.tasks.get(taskId);
    return task?.userId === userId ? { ...task } : null;
  }

  findTaskById(taskId: number): DownloadTask | null {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : null;
  }

  markDownloading(taskId: number): void {
    this.updateTask(taskId, "downloading", 0, null, null);
  }

  markFailed(taskId: number, message: string): void {
    const task = this.required(taskId);
    this.updateTask(taskId, "failed", task.progress, message, task.localPath);
  }

  markCompleted(taskId: number, localPath: string): void {
    if (this.failMarkCompleted) throw new Error("injected markCompleted failure");
    this.updateTask(taskId, "completed", 100, null, localPath);
  }

  recordCompletionWarning(taskId: number, message: string): void {
    this.required(taskId).errorMessage = message;
  }

  updateProgress(taskId: number, progress: number): void {
    this.required(taskId).progress = progress;
  }

  cancelTask(userId: number, taskId: number): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.userId !== userId || !["queued", "downloading"].includes(task.status)) {
      return false;
    }
    task.status = "canceled";
    return true;
  }

  updateTask(
    taskId: number,
    status: DownloadTaskStatus,
    progress: number,
    errorMessage: string | null,
    localPath: string | null,
  ): void {
    Object.assign(this.required(taskId), { status, progress, errorMessage, localPath });
  }

  all(): DownloadTask[] {
    return [...this.tasks.values()].map((task) => ({ ...task }));
  }

  private required(taskId: number): DownloadTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Missing task ${taskId}`);
    return task;
  }
}

function artifact() {
  return {
    content: Buffer.from("downloaded fixture"),
    localPath: "/tmp/acquisition-41.epub",
    fileName: "downloaded.epub",
    fileSize: 2048,
    mimeType: "application/epub+zip",
    checksum: "a".repeat(64),
  };
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Expected asynchronous download processing to settle");
}
