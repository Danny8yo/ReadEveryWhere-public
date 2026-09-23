import { createHash, randomUUID } from "node:crypto";
import type { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import type { BookSelectionPort } from "../../../intelligent-library/public/book-selection.port";
import type { AnnotationRepositoryPort } from "../application/ports/annotation-repository.port";
import type { AnnotationSelectionRepositoryPort } from "../application/ports/annotation-selection-repository.port";
import type { AnnotationSelectionCommand, AnnotationSelectionCommandReceipt, AnnotationSelectionCommandResult } from "../../public/annotation-selection-command.port";
import type { Annotation } from "../domain/annotation.types";
import type { ReadingStateChangePort } from "../../application/ports/reading-state-change.port";
import type { ReadingStateVersionPort } from "../../application/ports/reading-state-version.port";
import { ReadingStateError } from "../../domain/reading-state.error";

export class SqliteAnnotationSelectionRepository implements AnnotationSelectionRepositoryPort {
  constructor(private readonly sqlite: SqliteService, private readonly annotations: AnnotationRepositoryPort,
    private readonly selections: BookSelectionPort, private readonly changes: ReadingStateChangePort,
    private readonly versions: ReadingStateVersionPort) {}
  findReceipt(userId: number, commandId: string, requestDigest?: string): AnnotationSelectionCommandResult | null {
    const row = this.sqlite.getDatabase().prepare(`SELECT request_digest, result_json FROM annotation_selection_commands
      WHERE user_id = ? AND command_id = ?`).get(userId, commandId) as { request_digest: string; result_json: string } | undefined;
    if (!row) return null;
    if (requestDigest !== undefined && row.request_digest !== requestDigest)
      throw new ReadingStateError("ANNOTATION_COMMAND_CONFLICT", "commandId was already used with another request");
    const receipt = JSON.parse(row.result_json) as AnnotationSelectionCommandReceipt;
    const current = this.annotations.findById(receipt.annotation.id);
    return { receipt, currentAnnotation: current && current.userId === userId ? current : null, replayed: true };
  }
  private locationDigest(annotation: Annotation): string {
    return createHash("sha256").update(JSON.stringify([annotation.userId, annotation.bookId, annotation.bookHash,
      annotation.locationType, annotation.location, annotation.textContent, annotation.sectionIndex,
      annotation.textPositionStart, annotation.textPositionEnd])).digest("hex");
  }
  commit(userId: number, input: AnnotationSelectionCommand, validatedAnnotation: Annotation | null): AnnotationSelectionCommandResult {
    return this.changes.transact({ userId, changed: ["annotations"] }, () => {
      const replay = this.findReceipt(userId, input.commandId, input.requestDigest);
      if (replay) return { value: replay, bookId: null, didChange: false };
      if (!this.sqlite.getDatabase().isTransaction) throw new Error("Selection annotation commit requires an active SQLite transaction");
      // This synchronous public Port reads persisted artifact identity only. The
      // change coordinator already holds BEGIN IMMEDIATE; no file I/O in this fence.
      this.selections.assertCurrent(userId, input.selection);
      const now = Date.now(), bookId = input.selection.scope.bookId;
      let annotation: Annotation;
      if (input.target.kind === "append") {
        const current = this.annotations.findById(input.target.annotationId);
        if (!current || current.userId !== userId) throw ReadingStateError.annotationNotFound();
        if (!validatedAnnotation || current.revision !== input.target.expectedRevision
          || this.locationDigest(current) !== this.locationDigest(validatedAnnotation))
          throw ReadingStateError.annotationConflict(current);
        const write = this.annotations.updateAnnotation({ userId, annotationId: current.id,
          expectedRevision: current.revision, note: current.note ? `${current.note}\n\n${input.appendText}` : input.appendText, updatedAt: now });
        if (write.kind === "conflict") throw ReadingStateError.annotationConflict(write.current);
        if (write.kind !== "updated") throw ReadingStateError.annotationNotFound();
        annotation = write.annotation;
      } else {
        annotation = this.annotations.create({ id: randomUUID(), userId, bookId, bookHash: input.target.bookHash,
          annotationType: input.target.annotationType, color: input.target.color, location: input.target.cfi, locationType: "epubcfi",
          textContent: input.selection.displayedQuote.trim(), contextBefore: null, contextAfter: null,
          chapterLabel: input.target.chapterLabel ?? null, sectionIndex: input.selection.scope.sectionIndex,
          textPositionStart: input.selection.start, textPositionEnd: input.selection.end,
          sortKey: null, note: input.appendText, createdAt: now, updatedAt: now });
      }
      const receipt: AnnotationSelectionCommandReceipt = { commandId: input.commandId, annotation,
        readingStateVersion: this.versions.getRevision(userId, bookId) + 1, createdAt: now };
      this.sqlite.getDatabase().prepare(`INSERT INTO annotation_selection_commands
        (user_id, command_id, request_digest, result_json, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(userId, input.commandId, input.requestDigest, JSON.stringify(receipt), now);
      return { value: { receipt, currentAnnotation: annotation, replayed: false }, bookId, didChange: true };
    });
  }
}
