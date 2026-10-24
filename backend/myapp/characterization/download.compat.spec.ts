import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadCompatExport, normalizeBusinessError } from "./compat-loader";

const currentServicePath = "src/modules/acquisition/download/application/download.service";
const isCurrentArchitecture = existsSync(resolve(process.cwd(), `${currentServicePath}.ts`));
const DownloadService = loadCompatExport<any>([
  currentServicePath,
  "src/download/download.service",
], "DownloadService");
const AppException = loadCompatExport<any>([
  "src/platform/http/app-exception",
  "src/common/http/app-exception",
], "AppException");
const SourceRegistry = isCurrentArchitecture
  ? loadCompatExport<any>([
      "src/modules/acquisition/source-registry/application/source-registry",
    ], "SourceRegistry")
  : null;

const command = {
  bookId: 41,
  sourcePlatform: "zlibrary",
  sourceUrl: "/dl/source-41",
  fileName: "requested.epub",
};

describe("download state machine compatibility", () => {
  it("checks ownership before source reference and task creation", async () => {
    const context = createContext({ owned: false });

    const error = await captureAsync(() => context.service.createTask(7, command));

    expect(error).toMatchObject({ field: "bookId", message: "Book not found" });
    expect(context.tasks.all()).toHaveLength(0);
    expect(context.sourceReferenceLookup).not.toHaveBeenCalled();
  });

  it("requires a source reference before task creation", async () => {
    const context = createContext({ sourceReference: null });

    const error = await captureAsync(() => context.service.createTask(7, command));

    expect(error).toMatchObject({
      field: "bookId",
      message: "Book has no zlibrary source reference, add the book via from-search first",
    });
    expect(context.tasks.all()).toHaveLength(0);
  });

  it("rejects a source reference without a download hash", async () => {
    const context = createContext({ sourceReference: { sourceBookId: "source-41", hash: null } });

    const outcome = await captureOutcome(() => context.service.createTask(7, command));

    expect(outcome.status).toBe("rejected");
    const error = normalizeBusinessError(outcome.error);
    expect(error).toMatchObject({
      field: "bookId",
      message: "Book source reference is missing hash",
    });
    expect(context.tasks.all()).toHaveLength(0);
    expect(context.download).not.toHaveBeenCalled();
  });

  it("marks provider failures as failed without attaching a file", async () => {
    const context = createContext();
    context.download.mockRejectedValue(new Error("provider unavailable"));

    const queued = await context.service.createTask(7, command);
    await eventually(() => context.tasks.findTaskById(queued.id)?.status === "failed");

    expect(context.attach).not.toHaveBeenCalled();
    expect(context.tasks.findTaskById(queued.id)).toMatchObject({
      status: "failed",
      errorMessage: "provider unavailable",
      localPath: null,
    });
  });

  it("preserves an explicit upstream failure while keeping its details bounded", async () => {
    const context = createContext();
    context.download.mockRejectedValue(
      AppException.upstreamUnavailable("zlibrary file API request failed", { status: 503 }),
    );

    const queued = await context.service.createTask(7, command);
    await eventually(() => context.tasks.findTaskById(queued.id)?.status === "failed");

    expect(context.tasks.findTaskById(queued.id)).toMatchObject({
      status: "failed",
      errorMessage: 'zlibrary file API request failed (upstream={"status":503})',
    });
  });

  it("marks file attachment failures as failed", async () => {
    const context = createContext();
    context.attach.mockImplementation(() => {
      throw new Error("attach failed");
    });

    const queued = await context.service.createTask(7, command);
    await eventually(() => context.tasks.findTaskById(queued.id)?.status === "failed");

    expect(context.attach).toHaveBeenCalledTimes(1);
    expect(context.tasks.findTaskById(queued.id)).toMatchObject({
      status: "failed",
      errorMessage: "attach failed",
    });
  });

  it("keeps the attached file when markCompleted fails and records a failed task", async () => {
    const context = createContext();
    context.tasks.throwOnMarkCompleted = true;

    const queued = await context.service.createTask(7, command);
    await eventually(() => context.tasks.findTaskById(queued.id)?.status === "failed");

    expect(context.attach).toHaveBeenCalledTimes(1);
    expect(context.detach).not.toHaveBeenCalled();
    expect(context.attachedFiles).toHaveLength(1);
    expect(context.tasks.findTaskById(queued.id)).toMatchObject({
      status: "failed",
      errorMessage: "markCompleted failed",
      localPath: null,
    });
  });

  it("does not attach or complete after cancellation while the provider is pending", async () => {
    const deferred = createDeferred<any>();
    const context = createContext();
    context.download.mockReturnValue(deferred.promise);

    const queued = await context.service.createTask(7, command);
    await eventually(() => context.tasks.findTaskById(queued.id)?.status === "downloading");
    expect(context.service.cancelTask(7, queued.id)).toEqual({ canceled: true });

    deferred.resolve(artifact());
    await settle();

    expect(context.tasks.findTaskById(queued.id)?.status).toBe("canceled");
    expect(context.attach).not.toHaveBeenCalled();
    expect(context.tasks.markCompletedCalls).toBe(0);
  });

  it("does not overwrite cancellation when attach triggers the cancel/complete race", async () => {
    const deferred = createDeferred<any>();
    const context = createContext();
    context.download.mockReturnValue(deferred.promise);
    let taskId = 0;
    context.attach.mockImplementation(() => {
      context.attachedFiles.push(artifact());
      expect(context.service.cancelTask(7, taskId)).toEqual({ canceled: true });
      return {
        deliveryId: "compat-delivery",
        artifactId: "compat-artifact",
        localPath: "/tmp/download-41.epub",
        storedPath: "/tmp/download-41.epub",
        checksum: "a".repeat(64),
      };
    });

    const queued = await context.service.createTask(7, command);
    taskId = queued.id;
    await eventually(() => context.tasks.findTaskById(queued.id)?.status === "downloading");
    deferred.resolve(artifact());
    await settle();

    expect(context.tasks.findTaskById(queued.id)?.status).toBe("canceled");
    expect(context.attach).toHaveBeenCalledTimes(1);
    expect(context.detach).toHaveBeenCalledTimes(1);
    expect(context.attachedFiles).toHaveLength(0);
    expect(context.tasks.markCompletedCalls).toBe(0);
  });

  it("keeps the task completed when recordCompleted fails", async () => {
    const context = createContext({ recordCompletedError: new Error("counter failed") });

    const queued = await context.service.createTask(7, command);
    await eventually(() => context.tasks.findTaskById(queued.id)?.status === "completed");
    await settle();

    expect(context.recordCompleted).toHaveBeenCalledWith(7);
    expect(context.tasks.findTaskById(queued.id)).toMatchObject({
      status: "completed",
      progress: 100,
      localPath: "/tmp/download-41.epub",
      errorMessage: "Source completion accounting failed",
    });
  });

  it("deduplicates an existing file and never invokes the provider", async () => {
    const context = createContext({
      existingFile: { absolutePath: __filename, storedPath: "books/41/existing.epub" },
    });

    const result = await context.service.createTask(7, command);

    expect(result).toMatchObject({
      status: "completed",
      progress: 100,
      localPath: "books/41/existing.epub",
    });
    expect(context.download).not.toHaveBeenCalled();
    expect(context.attach).not.toHaveBeenCalled();
  });

  it.each(["completed", "failed", "canceled"])(
    "returns canceled=false when cancel is repeated for %s",
    async (status) => {
      const context = createContext();
      const task = context.tasks.createTask({
        userId: 7,
        bookId: 41,
        sourcePlatform: "zlibrary",
        sourceUrl: "/dl/source-41",
        requestedFileName: null,
        hash: "hash-41",
        sourceBookId: "source-41",
      });
      context.tasks.setStatus(task.id, status as any);

      expect(context.service.cancelTask(7, task.id)).toEqual({ canceled: false });
      expect(context.tasks.findTaskById(task.id)?.status).toBe(status);
    },
  );
});

function createContext(options: {
  owned?: boolean;
  sourceReference?: { sourceBookId: string; hash: string | null } | null;
  existingFile?: { absolutePath: string; storedPath: string } | null;
  recordCompletedError?: Error;
} = {}) {
  const tasks = new CompatDownloadTasks();
  const attachedFiles: any[] = [];
  const download = jest.fn().mockResolvedValue(artifact());
  const recordCompleted = options.recordCompletedError
    ? jest.fn().mockRejectedValue(options.recordCompletedError)
    : jest.fn().mockResolvedValue(undefined);
  const source = { platform: "zlibrary", download, recordCompleted };
  const ownership = jest.fn().mockReturnValue(options.owned ?? true);
  const sourceReferenceLookup = jest.fn().mockReturnValue(
    options.sourceReference === undefined
      ? { sourceBookId: "source-41", hash: "hash-41" }
      : options.sourceReference,
  );
  const existingFileLookup = jest.fn().mockReturnValue(options.existingFile ?? null);
  const attach = jest.fn((input: any) => {
    attachedFiles.push(input);
    return {
      deliveryId: input.deliveryId ?? "compat-delivery",
      artifactId: "compat-artifact",
      localPath: input.localPath ?? "/tmp/download-41.epub",
      storedPath: input.localPath ?? "/tmp/download-41.epub",
      checksum: input.checksum,
    };
  });
  const detach = jest.fn(() => {
    attachedFiles.splice(0, attachedFiles.length);
  });
  let service: any;

  if (isCurrentArchitecture) {
    service = new DownloadService(
      tasks,
      new SourceRegistry([], [source]),
      { isOwnedByUser: ({ userId, bookId }: any) => ownership(userId, bookId) },
      { findForDownload: ({ userId, bookId }: any) => sourceReferenceLookup(userId, bookId) },
      { findExisting: ({ userId, bookId }: any) => existingFileLookup(userId, bookId) },
      { attach, detach },
    );
  } else {
    tasks.bookExistsForUser = (userId: number, bookId: number) => ownership(userId, bookId);
    tasks.findSourceRef = (userId: number, bookId: number) => sourceReferenceLookup(userId, bookId);
    tasks.findExistingLocalFile = (userId: number, bookId: number) => {
      const found = existingFileLookup(userId, bookId);
      return found ? { localPath: found.absolutePath } : null;
    };
    tasks.upsertBookFile = (input: any) => attach(input);
    service = new DownloadService(
      tasks,
      { download: (_platform: string, sourceUrl: string, input: any) => download(sourceUrl, input) },
      { incrementDownloadsToday: (userId: number) => recordCompleted(userId) },
      { toRelative: (localPath: string) => (
        options.existingFile?.absolutePath === localPath
          ? options.existingFile.storedPath
          : localPath
      ) },
    );
  }

  return {
    service,
    tasks,
    download,
    recordCompleted,
    attach,
    detach,
    attachedFiles,
    ownership,
    sourceReferenceLookup,
    existingFileLookup,
  };
}

class CompatDownloadTasks {
  private readonly values = new Map<number, any>();
  private nextId = 1;
  throwOnMarkCompleted = false;
  markCompletedCalls = 0;
  bookExistsForUser = (_userId: number, _bookId: number) => true;
  findSourceRef = (_userId: number, _bookId: number): any => null;
  findExistingLocalFile = (_userId: number, _bookId: number): any => null;
  upsertBookFile = (_input: any): void => undefined;
  markBookFileFailed = (_userId: number, _bookId: number, _message: string): void => undefined;

  createTask(input: any) {
    const now = new Date().toISOString();
    const task = {
      id: this.nextId++,
      ...input,
      status: "queued",
      progress: 0,
      localPath: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    this.values.set(task.id, task);
    return { ...task };
  }

  findTaskByIdForUser(userId: number, taskId: number) {
    const task = this.values.get(taskId);
    return task?.userId === userId ? { ...task } : null;
  }

  findTaskById(taskId: number) {
    const task = this.values.get(taskId);
    return task ? { ...task } : null;
  }

  markDownloading(taskId: number) {
    this.setStatus(taskId, "downloading");
  }

  updateTask(taskId: number, status: string, progress: number, errorMessage: string | null, localPath: string | null, phase = status) {
    Object.assign(this.required(taskId), { status, phase, progress, errorMessage, localPath });
  }

  markFailed(taskId: number, message: string) {
    const task = this.required(taskId);
    Object.assign(task, { status: "failed", errorMessage: message });
  }

  markCompleted(taskId: number, localPath: string) {
    this.markCompletedCalls += 1;
    if (this.throwOnMarkCompleted) throw new Error("markCompleted failed");
    Object.assign(this.required(taskId), {
      status: "completed",
      progress: 100,
      errorMessage: null,
      localPath,
    });
  }

  recordCompletionWarning(taskId: number, message: string) {
    this.required(taskId).errorMessage = message;
  }

  updateProgress(taskId: number, progress: number) {
    this.required(taskId).progress = progress;
  }

  cancelTask(userId: number, taskId: number) {
    const task = this.values.get(taskId);
    if (!task || task.userId !== userId || !["queued", "downloading"].includes(task.status)) return false;
    task.status = "canceled";
    return true;
  }

  setStatus(taskId: number, status: string) {
    this.required(taskId).status = status;
  }

  all() {
    return [...this.values.values()].map((value) => ({ ...value }));
  }

  private required(taskId: number) {
    const task = this.values.get(taskId);
    if (!task) throw new Error(`Missing task ${taskId}`);
    return task;
  }
}

function artifact() {
  return {
    localPath: "/tmp/download-41.epub",
    fileName: "download-41.epub",
    fileSize: 2048,
    mimeType: "application/epub+zip",
    checksum: "a".repeat(64),
  };
}

function createDeferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function captureAsync(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    return normalizeBusinessError(error);
  }
  throw new Error("Expected action to reject");
}

async function captureOutcome(action: () => Promise<unknown>) {
  try {
    return { status: "resolved" as const, value: await action(), error: null };
  } catch (error) {
    return { status: "rejected" as const, value: null, error };
  }
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
  }
  throw new Error("Expected asynchronous task processing to settle");
}

async function settle(): Promise<void> {
  await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
  await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
}
