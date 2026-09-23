import { LIBRARY_PROJECTION_CHANGE_PORT, type LibraryProjectionChangePort } from "../../public/library-projection-change.port";
import { afterCommit, transact } from "../../../../platform/persistence/sqlite/transaction";
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ContentRevision } from "../../book-content/domain/book-document.types";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import type {
  BookAnalysisLease,
  BookAnalysisSnapshot,
  BookAnalysisStorePort,
  ClaimedBookAnalysisTask,
} from "../application/ports/book-analysis-store.port";
import { BookAnalysisTask, type BookAnalysisTaskJSON } from "../domain/book-analysis-task";
import { BookReadingProfileCandidate, type BookReadingProfileCandidateJSON } from "../domain/book-reading-profile-candidate";

interface ProfileRow {
  id: string;
  user_id: number;
  book_id: number;
  primary_genre: BookReadingProfileCandidateJSON["primaryGenre"];
  secondary_genres_json: string;
  traits_json: string;
  confidence: number;
  classification_summary: string;
  content_revision: string;
  model_id: string;
  strategy_version: string;
  analyzed_at: string;
  base_profile_version: number;
  status: "pending" | "applied";
}

interface TaskRow {
  id: string;
  state_json: string;
  status: BookAnalysisTaskJSON["status"];
  lease_owner: string | null;
  lease_token: string | null;
  lease_generation: number;
  lease_expires_at: string | null;
}

@Injectable()
export class BookAnalysisRepository implements BookAnalysisStorePort {
  constructor(private readonly sqlite: SqliteService, @Inject(LIBRARY_PROJECTION_CHANGE_PORT) private readonly changes: LibraryProjectionChangePort) {}

  saveProfile(profile: BookReadingProfileCandidate, baseProfileVersion: number): void {
    const value = profile.toJSON();
    const database = this.sqlite.getDatabase();
    transaction(database, () => {
      database.prepare(`
        UPDATE book_analysis_candidates
        SET status = 'superseded', updated_at = ?
        WHERE user_id = ? AND book_id = ? AND status = 'pending'
      `).run(value.analyzedAt, value.userId, value.bookId);
      database.prepare(`
        INSERT INTO book_analysis_candidates (
          id, user_id, book_id, primary_genre, secondary_genres_json, traits_json,
          confidence, classification_summary, content_revision, model_id,
          strategy_version, analyzed_at, base_profile_version, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          primary_genre = excluded.primary_genre,
          secondary_genres_json = excluded.secondary_genres_json,
          traits_json = excluded.traits_json,
          confidence = excluded.confidence,
          classification_summary = excluded.classification_summary,
          content_revision = excluded.content_revision,
          model_id = excluded.model_id,
          strategy_version = excluded.strategy_version,
          analyzed_at = excluded.analyzed_at,
          base_profile_version = excluded.base_profile_version,
          status = excluded.status,
          updated_at = excluded.updated_at
      `).run(
        value.id,
        value.userId,
        value.bookId,
        value.primaryGenre,
        JSON.stringify(value.secondaryGenres),
        JSON.stringify(value.traits),
        value.confidence,
        value.classificationSummary,
        revisionKey(value.contentRevision),
        value.modelId,
        value.strategyVersion,
        value.analyzedAt,
        baseProfileVersion,
        "pending",
        value.analyzedAt,
        value.analyzedAt,
      );
      afterCommit(database, () => this.changes.changed(value.userId));
    });
  }

  getSnapshot(
    userId: number,
    bookId: number,
    contentRevision: ContentRevision,
    strategyVersion: string,
  ): BookAnalysisSnapshot {
    const database = this.sqlite.getDatabase();
    const revision = revisionKey(contentRevision);
    const active = database.prepare(`
      SELECT id, state_json, status, lease_owner, lease_token, lease_generation, lease_expires_at
      FROM book_analysis_tasks
      WHERE user_id = ? AND book_id = ? AND content_revision = ? AND strategy_version = ?
        AND status IN ('pending', 'running')
      ORDER BY created_at DESC LIMIT 1
    `).get(userId, bookId, revision, strategyVersion) as unknown as TaskRow | undefined;
    if (active) {
      return { status: active.status, stale: false, candidate: null, errorCode: null };
    }

    const currentProfile = database.prepare(`
      SELECT * FROM book_analysis_candidates
      WHERE user_id = ? AND book_id = ? AND content_revision = ? AND strategy_version = ?
        AND status IN ('pending', 'applied')
      ORDER BY analyzed_at DESC LIMIT 1
    `).get(userId, bookId, revision, strategyVersion) as unknown as ProfileRow | undefined;
    if (currentProfile) {
      const candidate = {
        ...mapProfile(currentProfile).toJSON(),
        baseProfileVersion: currentProfile.base_profile_version,
        status: currentProfile.status,
      };
      return { status: "ready", stale: false, candidate, errorCode: null };
    }

    const failed = database.prepare(`
      SELECT id, state_json, status, lease_owner, lease_token, lease_generation, lease_expires_at
      FROM book_analysis_tasks
      WHERE user_id = ? AND book_id = ? AND content_revision = ? AND strategy_version = ?
        AND status = 'failed'
      ORDER BY created_at DESC LIMIT 1
    `).get(userId, bookId, revision, strategyVersion) as unknown as TaskRow | undefined;
    if (failed) {
      const task = mapTask(failed);
      return { status: "failed", stale: false, candidate: null, errorCode: task.toJSON().errorCode };
    }

    const latest = database.prepare(`
      SELECT content_revision, strategy_version
      FROM book_analysis_candidates
      WHERE user_id = ? AND book_id = ?
      ORDER BY analyzed_at DESC, created_at DESC, id DESC
      LIMIT 1
    `).get(userId, bookId) as unknown as {
      content_revision: string;
      strategy_version: string;
    } | undefined;
    return latest && (latest.content_revision !== revision || latest.strategy_version !== strategyVersion)
      ? { status: "stale", stale: true, candidate: null, errorCode: null }
      : { status: "not_analyzed", stale: false, candidate: null, errorCode: null };
  }

  enqueueIfAbsent(task: BookAnalysisTask): { created: boolean; task: BookAnalysisTask } {
    const database = this.sqlite.getDatabase();
    return transaction(database, () => {
      const value = task.toJSON();
      const existing = database.prepare(`
        SELECT id, state_json, status, lease_owner, lease_token, lease_generation, lease_expires_at
        FROM book_analysis_tasks
        WHERE user_id = ? AND book_id = ? AND content_revision = ? AND strategy_version = ?
          AND status IN ('pending', 'running')
        ORDER BY created_at DESC LIMIT 1
      `).get(
        value.userId,
        value.bookId,
        revisionKey(value.contentRevision),
        value.strategyVersion,
      ) as unknown as TaskRow | undefined;
      if (existing) return { created: false, task: mapTask(existing) };

      database.prepare(`
        INSERT INTO book_analysis_tasks (
          id, user_id, book_id, content_revision, model_id, strategy_version,
          status, state_json, created_at, updated_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        value.id,
        value.userId,
        value.bookId,
        revisionKey(value.contentRevision),
        value.modelId,
        value.strategyVersion,
        value.status,
        JSON.stringify(value),
        value.requestedAt,
        value.requestedAt,
        value.finishedAt,
      );
      afterCommit(database, () => this.changes.changed(value.userId));
      return { created: true, task };
    });
  }

  claimNext(workerId: string, now: string, leaseMs: number): ClaimedBookAnalysisTask | null {
    const database = this.sqlite.getDatabase();
    return transaction(database, () => {
      const row = database.prepare(`
        SELECT id, state_json, status, lease_owner, lease_token, lease_generation, lease_expires_at
        FROM book_analysis_tasks
        WHERE status = 'pending'
           OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= ?))
        ORDER BY created_at ASC LIMIT 1
      `).get(now) as unknown as TaskRow | undefined;
      if (!row) return null;

      const resumed = row.status === "running";
      const task = mapTask(row);
      if (!resumed) task.start(now);
      const lease: BookAnalysisLease = {
        taskId: task.id,
        workerId,
        leaseToken: randomUUID(),
        generation: row.lease_generation + 1,
        expiresAt: new Date(new Date(now).getTime() + leaseMs).toISOString(),
      };
      const value = task.toJSON();
      database.prepare(`
        UPDATE book_analysis_tasks SET
          status = ?, state_json = ?, lease_owner = ?, lease_token = ?,
          lease_generation = ?, lease_expires_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        value.status,
        JSON.stringify(value),
        lease.workerId,
        lease.leaseToken,
        lease.generation,
        lease.expiresAt,
        now,
        task.id,
      );
      if (!resumed) afterCommit(database, () => this.changes.changed(value.userId));
      return { task, lease, resumed };
    });
  }

  complete(input: { taskId: string; profileId: string; lease: BookAnalysisLease; now: string }): boolean {
    return this.finish(input.taskId, input.lease, (task) => task.complete(input.profileId, input.now));
  }

  fail(input: { taskId: string; errorCode: string; lease: BookAnalysisLease; now: string }): boolean {
    return this.finish(input.taskId, input.lease, (task) => task.fail(input.errorCode, input.now));
  }

  releaseLease(lease: BookAnalysisLease): boolean {
    const result = this.sqlite.getDatabase().prepare(`
      UPDATE book_analysis_tasks
      SET lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
      WHERE id = ? AND lease_owner = ? AND lease_token = ? AND lease_generation = ?
    `).run(lease.taskId, lease.workerId, lease.leaseToken, lease.generation);
    return result.changes > 0;
  }

  getCandidate(userId: number, candidateId: string): (BookReadingProfileCandidateJSON & { baseProfileVersion: number; status: string }) | null {
    const row = this.sqlite.getDatabase().prepare(`
      SELECT * FROM book_analysis_candidates WHERE user_id = ? AND id = ? LIMIT 1
    `).get(userId, candidateId) as unknown as (ProfileRow & { base_profile_version: number; status: string }) | undefined;
    if (!row) return null;
    return { ...mapProfile(row).toJSON(), baseProfileVersion: row.base_profile_version, status: row.status };
  }

  consumeCandidate<T>(
    candidateId: string,
    apply: () => T,
  ): { consumed: true; value: T } | { consumed: false } {
    const database = this.sqlite.getDatabase();
    return transaction(database, () => {
      const result = database.prepare(`
        UPDATE book_analysis_candidates SET status = 'applied', updated_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(new Date().toISOString(), candidateId);
      if (Number(result.changes) === 0) return { consumed: false };
      return { consumed: true, value: apply() };
    });
  }

  private finish(
    taskId: string,
    lease: BookAnalysisLease,
    transition: (task: BookAnalysisTask) => void,
  ): boolean {
    const database = this.sqlite.getDatabase();
    return transaction(database, () => {
      const row = database.prepare(`
        SELECT id, state_json, status, lease_owner, lease_token, lease_generation, lease_expires_at
        FROM book_analysis_tasks WHERE id = ?
      `).get(taskId) as unknown as TaskRow | undefined;
      if (!row
        || row.lease_owner !== lease.workerId
        || row.lease_token !== lease.leaseToken
        || row.lease_generation !== lease.generation) return false;
      const task = mapTask(row);
      transition(task);
      const value = task.toJSON();
      database.prepare(`
        UPDATE book_analysis_tasks SET
          status = ?, state_json = ?, updated_at = ?, finished_at = ?,
          lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
        WHERE id = ? AND lease_token = ? AND lease_generation = ?
      `).run(
        value.status,
        JSON.stringify(value),
        value.finishedAt ?? value.requestedAt,
        value.finishedAt,
        taskId,
        lease.leaseToken,
        lease.generation,
      );
      afterCommit(database, () => this.changes.changed(value.userId));
      return true;
    });
  }
}

function mapProfile(row: ProfileRow): BookReadingProfileCandidate {
  return BookReadingProfileCandidate.fromJSON({
    id: row.id,
    userId: row.user_id,
    bookId: row.book_id,
    primaryGenre: row.primary_genre,
    secondaryGenres: JSON.parse(row.secondary_genres_json),
    traits: JSON.parse(row.traits_json),
    confidence: row.confidence,
    classificationSummary: row.classification_summary,
    contentRevision: parseRevision(row.content_revision),
    modelId: row.model_id,
    strategyVersion: row.strategy_version,
    analyzedAt: row.analyzed_at,
  });
}

function mapTask(row: TaskRow): BookAnalysisTask {
  return BookAnalysisTask.fromJSON(JSON.parse(row.state_json) as BookAnalysisTaskJSON);
}

function revisionKey(revision: ContentRevision): string {
  return JSON.stringify(revision);
}

function parseRevision(value: string): ContentRevision {
  return JSON.parse(value) as ContentRevision;
}

const transaction = transact;
