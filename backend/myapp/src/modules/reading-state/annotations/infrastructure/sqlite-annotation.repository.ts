import { Injectable } from "@nestjs/common";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import type { AnnotationQueryPort } from "../../public";
import type { AnnotationRepositoryPort } from "../application/ports/annotation-repository.port";
import { Annotation, AnnotationWriteResult, CreateAnnotationInput } from "../domain/annotation.types";

interface AnnotationRow {
  id: string;
  user_id: number;
  book_id: number;
  book_hash: string;
  annotation_type: string;
  color: string;
  location: string;
  location_type: string;
  text_content: string;
  context_before: string | null;
  context_after: string | null;
  chapter_label: string | null;
  section_index: number | null;
  text_position_start: number | null;
  text_position_end: number | null;
  sort_key: number | null;
  note: string | null;
  created_at: number;
  updated_at: number;
  revision: number;
}

@Injectable()
export class SqliteAnnotationRepository implements AnnotationRepositoryPort, AnnotationQueryPort {
  constructor(private readonly sqliteService: SqliteService) {}

  create(input: CreateAnnotationInput & { createdAt: number; updatedAt: number }): Annotation {
    const db = this.sqliteService.getDatabase();
    const stmt = db.prepare(`
      INSERT INTO annotations (
        id, user_id, book_id, book_hash, annotation_type, color,
        location, location_type, text_content, context_before, context_after,
        chapter_label, section_index, text_position_start, text_position_end,
        sort_key, note, created_at, updated_at, revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    stmt.run(
      input.id, input.userId, input.bookId, input.bookHash,
      input.annotationType, input.color, input.location, input.locationType,
      input.textContent, input.contextBefore, input.contextAfter,
      input.chapterLabel, input.sectionIndex ?? null,
      input.textPositionStart ?? null, input.textPositionEnd ?? null,
      input.sortKey, input.note,
      input.createdAt, input.updatedAt,
    );
    return this.findById(input.id)!;
  }

  findById(id: string): Annotation | null {
    const db = this.sqliteService.getDatabase();
    const row = db.prepare("SELECT * FROM annotations WHERE id = ?").get(id) as unknown as AnnotationRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByBook(userId: number, bookId: number): Annotation[] {
    const db = this.sqliteService.getDatabase();
    const rows = db.prepare(`
      SELECT * FROM annotations
      WHERE user_id = ? AND book_id = ?
      ORDER BY sort_key ASC
    `).all(userId, bookId) as unknown as AnnotationRow[];
    return rows.map((r) => this.mapRow(r));
  }

  listByBook(query: Readonly<{ userId: number; bookId: number }>): readonly Annotation[] {
    return this.findByBook(query.userId, query.bookId);
  }

  findByIdempotencyKey(
    userId: number,
    bookHash: string,
    location: string,
    textContent: string,
  ): Annotation | null {
    const db = this.sqliteService.getDatabase();
    const row = db.prepare(`
      SELECT * FROM annotations
      WHERE user_id = ? AND book_hash = ? AND location = ? AND text_content = ?
      LIMIT 1
    `).get(userId, bookHash, location, textContent) as unknown as AnnotationRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  updateAnnotation(input: {
    userId: number;
    annotationId: string;
    annotationType?: string;
    color?: string;
    note?: string | null;
    updatedAt: number;
    expectedRevision: number;
  }): AnnotationWriteResult {
    const db = this.sqliteService.getDatabase();
    const existing = this.findById(input.annotationId);
    if (!existing || existing.userId !== input.userId) return { kind: "not_found" };
    if (existing.revision !== input.expectedRevision) {
      return { kind: "conflict", current: existing };
    }

    const setClauses: string[] = [];
    const params: any[] = [];

    if (input.annotationType !== undefined) {
      setClauses.push("annotation_type = ?");
      params.push(input.annotationType);
    }
    if (input.color !== undefined) {
      setClauses.push("color = ?");
      params.push(input.color);
    }
    if (input.note !== undefined) {
      setClauses.push("note = ?");
      params.push(input.note);
    }

    if (setClauses.length === 0) return { kind: "updated", annotation: existing };

    setClauses.push("updated_at = ?");
    params.push(input.updatedAt);
    setClauses.push("revision = revision + 1");

    params.push(input.userId, input.annotationId, input.expectedRevision);
    const result = db.prepare(`
      UPDATE annotations SET ${setClauses.join(", ")}
      WHERE user_id = ? AND id = ? AND revision = ?
    `).run(...params);

    if (result.changes > 0) {
      return { kind: "updated", annotation: this.findById(input.annotationId)! };
    }
    const current = this.findById(input.annotationId);
    return current && current.userId === input.userId
      ? { kind: "conflict", current }
      : { kind: "not_found" };
  }

  deleteAnnotation(id: string, userId: number, expectedRevision: number): AnnotationWriteResult {
    const db = this.sqliteService.getDatabase();
    const existing = this.findById(id);
    if (!existing || existing.userId !== userId) return { kind: "not_found" };
    if (existing.revision !== expectedRevision) return { kind: "conflict", current: existing };
    const result = db.prepare("DELETE FROM annotations WHERE id = ? AND user_id = ? AND revision = ?")
      .run(id, userId, expectedRevision);
    if (result.changes > 0) return { kind: "deleted", annotation: existing };
    const current = this.findById(id);
    return current && current.userId === userId
      ? { kind: "conflict", current }
      : { kind: "not_found" };
  }

  private mapRow(row: AnnotationRow): Annotation {
    return {
      id: row.id,
      userId: row.user_id,
      bookId: row.book_id,
      bookHash: row.book_hash,
      annotationType: row.annotation_type as Annotation["annotationType"],
      color: row.color,
      location: row.location,
      locationType: row.location_type as Annotation["locationType"],
      textContent: row.text_content,
      contextBefore: row.context_before,
      contextAfter: row.context_after,
      chapterLabel: row.chapter_label,
      sectionIndex: row.section_index,
      textPositionStart: row.text_position_start,
      textPositionEnd: row.text_position_end,
      sortKey: row.sort_key,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
    };
  }
}
