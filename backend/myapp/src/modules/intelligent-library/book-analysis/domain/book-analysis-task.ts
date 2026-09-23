import type { ContentRevision } from "../../book-content/domain/book-document.types";
import { BookAnalysisDomainError } from "./book-reading-profile-candidate";

export type BookAnalysisTaskStatus = "pending" | "running" | "ready" | "failed";

export interface BookAnalysisTaskJSON {
  id: string;
  userId: number;
  bookId: number;
  contentRevision: ContentRevision;
  modelId: string;
  strategyVersion: string;
  status: BookAnalysisTaskStatus;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  profileId: string | null;
  errorCode: string | null;
}

export type CreateBookAnalysisTaskInput = Omit<
  BookAnalysisTaskJSON,
  "status" | "startedAt" | "finishedAt" | "profileId" | "errorCode"
>;

export class BookAnalysisTask {
  private constructor(private value: BookAnalysisTaskJSON) {}

  static create(input: CreateBookAnalysisTaskInput): BookAnalysisTask {
    return new BookAnalysisTask({
      ...input,
      contentRevision: { ...input.contentRevision },
      status: "pending",
      startedAt: null,
      finishedAt: null,
      profileId: null,
      errorCode: null,
    });
  }

  static fromJSON(input: BookAnalysisTaskJSON): BookAnalysisTask {
    requireTaskState(input);
    return new BookAnalysisTask({
      ...input,
      contentRevision: { ...input.contentRevision },
    });
  }

  get id() { return this.value.id; }
  get userId() { return this.value.userId; }
  get bookId() { return this.value.bookId; }
  get status() { return this.value.status; }
  get contentRevision() { return { ...this.value.contentRevision }; }
  get modelId() { return this.value.modelId; }
  get strategyVersion() { return this.value.strategyVersion; }

  start(now: string): void {
    this.requireStatus("pending");
    this.value.status = "running";
    this.value.startedAt = now;
    this.value.errorCode = null;
  }

  complete(profileId: string, now: string): void {
    this.requireStatus("running");
    if (!profileId.trim()) {
      throw new BookAnalysisDomainError(
        "ANALYSIS_TASK_PROFILE_INVALID",
        "A completed task requires a profile id",
      );
    }
    this.value.status = "ready";
    this.value.profileId = profileId;
    this.value.errorCode = null;
    this.value.finishedAt = now;
  }

  fail(errorCode: string, now: string): void {
    this.requireStatus("running");
    if (!errorCode.trim()) {
      throw new BookAnalysisDomainError(
        "ANALYSIS_TASK_ERROR_INVALID",
        "A failed task requires an error code",
      );
    }
    this.value.status = "failed";
    this.value.errorCode = errorCode;
    this.value.profileId = null;
    this.value.finishedAt = now;
  }

  toJSON(): BookAnalysisTaskJSON {
    return { ...this.value, contentRevision: { ...this.value.contentRevision } };
  }

  private requireStatus(expected: BookAnalysisTaskStatus): void {
    if (this.value.status !== expected) {
      throw new BookAnalysisDomainError(
        "ANALYSIS_TASK_TRANSITION_INVALID",
        `Cannot transition task from ${this.value.status}; expected ${expected}`,
      );
    }
  }
}

function requireTaskState(input: BookAnalysisTaskJSON): void {
  if (!input || typeof input !== "object") {
    throw new BookAnalysisDomainError("ANALYSIS_TASK_STATE_INVALID", "Task state must be an object");
  }
  if (typeof input.id !== "string" || !input.id.trim()
    || !Number.isInteger(input.userId) || input.userId <= 0
    || !Number.isInteger(input.bookId) || input.bookId <= 0) {
    throw new BookAnalysisDomainError("ANALYSIS_TASK_STATE_INVALID", "Task identity is invalid");
  }
  if (!["pending", "running", "ready", "failed"].includes(input.status)) {
    throw new BookAnalysisDomainError("ANALYSIS_TASK_STATE_INVALID", "Task status is invalid");
  }
  if (!input.contentRevision
    || typeof input.contentRevision.fileChecksum !== "string"
    || typeof input.contentRevision.extractorVersion !== "string"
    || typeof input.contentRevision.normalizationVersion !== "string") {
    throw new BookAnalysisDomainError("ANALYSIS_TASK_STATE_INVALID", "Task content revision is invalid");
  }
  for (const [field, value] of [["modelId", input.modelId], ["strategyVersion", input.strategyVersion], ["requestedAt", input.requestedAt]] as const) {
    if (typeof value !== "string" || !value.trim()) {
      throw new BookAnalysisDomainError("ANALYSIS_TASK_STATE_INVALID", `Task ${field} is invalid`);
    }
  }
  for (const [field, value] of [["startedAt", input.startedAt], ["finishedAt", input.finishedAt], ["profileId", input.profileId], ["errorCode", input.errorCode]] as const) {
    if (value !== null && typeof value !== "string") {
      throw new BookAnalysisDomainError("ANALYSIS_TASK_STATE_INVALID", `Task ${field} is invalid`);
    }
  }
  if (input.status === "ready" && !input.profileId) {
    throw new BookAnalysisDomainError("ANALYSIS_TASK_STATE_INVALID", "Ready task requires a profile id");
  }
  if (input.status === "failed" && !input.errorCode) {
    throw new BookAnalysisDomainError("ANALYSIS_TASK_STATE_INVALID", "Failed task requires an error code");
  }
}
