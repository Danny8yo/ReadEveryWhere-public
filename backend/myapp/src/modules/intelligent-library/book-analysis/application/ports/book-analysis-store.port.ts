import type { ContentRevision } from "../../../book-content/domain/book-document.types";
import type { BookAnalysisTask } from "../../domain/book-analysis-task";
import type { BookReadingProfileCandidate, BookReadingProfileCandidateJSON } from "../../domain/book-reading-profile-candidate";

export type BookAnalysisStatus =
  | "not_analyzed"
  | "pending"
  | "running"
  | "ready"
  | "failed"
  | "stale"
  | "unsupported";

export interface BookAnalysisSnapshot {
  status: BookAnalysisStatus;
  stale: boolean;
  candidate: (BookReadingProfileCandidateJSON & {
    baseProfileVersion: number;
    status: "pending" | "applied";
  }) | null;
  errorCode: string | null;
}

export interface BookAnalysisLease {
  taskId: string;
  workerId: string;
  leaseToken: string;
  generation: number;
  expiresAt: string;
}

export interface ClaimedBookAnalysisTask {
  task: BookAnalysisTask;
  lease: BookAnalysisLease;
  resumed: boolean;
}

export interface BookAnalysisStorePort {
  saveProfile(profile: BookReadingProfileCandidate, baseProfileVersion: number): void;
  getSnapshot(
    userId: number,
    bookId: number,
    contentRevision: ContentRevision,
    strategyVersion: string,
  ): BookAnalysisSnapshot;
  enqueueIfAbsent(task: BookAnalysisTask): { created: boolean; task: BookAnalysisTask };
  claimNext(workerId: string, now: string, leaseMs: number): ClaimedBookAnalysisTask | null;
  complete(input: { taskId: string; profileId: string; lease: BookAnalysisLease; now: string }): boolean;
  fail(input: { taskId: string; errorCode: string; lease: BookAnalysisLease; now: string }): boolean;
  releaseLease(lease: BookAnalysisLease): boolean;
  getCandidate(userId: number, candidateId: string): BookReadingProfileCandidateJSON & { baseProfileVersion: number; status: string } | null;
  consumeCandidate<T>(
    candidateId: string,
    apply: () => T,
  ): { consumed: true; value: T } | { consumed: false };
}
