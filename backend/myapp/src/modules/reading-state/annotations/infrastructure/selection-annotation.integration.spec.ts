import { EpubSelectionResolverAdapter } from "../../../intelligent-library/book-content/infrastructure/epub-selection-resolver.adapter";
import AdmZip from "adm-zip";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema } from "../../../../platform/persistence/sqlite/schema-migrations";
import { SqliteService } from "../../../../platform/persistence/sqlite/sqlite.service";
import { SqliteCurrentBookArtifactFence } from "../../../intelligent-library/catalog/infrastructure/persistence/sqlite/sqlite-current-book-artifact-fence";
import { CatalogBookContentSourceAdapter } from "../../../intelligent-library/book-content/infrastructure/catalog-book-content-source.adapter";
import { ResolveBookSelectionService } from "../../../intelligent-library/book-content/application/resolve-book-selection.service";
import { EpubDocumentExtractor } from "../../../intelligent-library/book-content/infrastructure/epub-document.extractor";
import { SqliteAnnotationRepository } from "./sqlite-annotation.repository";
import { SqliteAnnotationSelectionRepository } from "./sqlite-annotation-selection.repository";
import { ApplySelectionAnnotationUseCase } from "../application/use-cases/apply-selection-annotation.use-case";
import { BookContentSelectionAdapter } from "./book-content-selection.adapter";
import { ReadingStateEventBus } from "../../application/reading-state-event-bus";
import { SqliteReadingStateChangeCoordinator } from "../../infrastructure/sqlite-reading-state-change-coordinator";
import { SqliteReadingStateVersionRepository } from "../../infrastructure/sqlite-reading-state-version.repository";
import type { AnnotationSelectionCommand } from "../../public/annotation-selection-command.port";

const quote = " 重复句子。 ";
const cfi = "epubcfi(/6/2!/4/6[second],/1:0,/1:7)";
function epub(): Buffer {
  const zip = new AdmZip();
  const files = {
    "META-INF/container.xml": '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "OPS/book.opf": '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest><item id="c" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>',
    "OPS/chapter.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>fixture</title></head><body><h1>头</h1><p id="first">${quote}</p><p id="second">${quote}</p><p>尾</p></body></html>`,
  };
  for (const [name, text] of Object.entries(files)) zip.addFile(name, Buffer.from(text));
  return zip.toBuffer();
}

describe("selection annotation transaction integration", () => {
  let db: DatabaseSync, root: string, filePath: string, checksum: string;
  let command: AnnotationSelectionCommand, service: ApplySelectionAnnotationUseCase;
  let selections: ResolveBookSelectionService, annotations: SqliteAnnotationRepository;
  let receipts: SqliteAnnotationSelectionRepository, versions: SqliteReadingStateVersionRepository;
  let published: jest.Mock;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "selection-annotation-"));
    const bytes = epub(); filePath = join(root, "book.epub"); writeFileSync(filePath, bytes);
    checksum = createHash("sha256").update(bytes).digest("hex");
    db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON"); initializeSchema(db);
    db.exec(`INSERT INTO users (id,email,password_hash,created_at,updated_at) VALUES (1,'a@test','hash','now','now');
      INSERT INTO books (id,user_id,title,title_normalized,authors_json,authors_text,version,created_at,updated_at)
      VALUES (1,1,'Fixture','fixture','[]','',1,'now','now');`);
    db.prepare(`INSERT INTO book_artifacts (artifact_id,delivery_id,user_id,book_id,status,stored_path,file_name,mime_type,checksum,created_at,updated_at)
      VALUES ('artifact-1','delivery-1',1,1,'active','fixture.epub','fixture.epub','application/epub+zip',?,'now','now')`).run(checksum);
    db.exec("INSERT INTO book_current_artifacts VALUES (1,'artifact-1','now')");
    const sqlite = { getDatabase: () => db } as unknown as SqliteService;
    const fence = new SqliteCurrentBookArtifactFence(sqlite), extractor = new EpubDocumentExtractor();
    const source = new CatalogBookContentSourceAdapter({
      findById: (userId, bookId) => userId === 1 && bookId === 1 ? { id: 1, title: "Fixture", authors: [] } : null,
      findReadableFile: () => ({ filePath, fileName: "fixture.epub", mimeType: "application/epub+zip", downloadStatus: "completed", artifactId: "artifact-1", checksum }),
    });
    selections = new ResolveBookSelectionService(source, fence, extractor, new EpubSelectionResolverAdapter());
    const selection = await selections.resolveSelection(1, { scope: { bookId: 1, fileChecksum: `sha256:${checksum}`,
      extractorVersion: extractor.extractorVersion, normalizationVersion: extractor.normalizationVersion,
      sectionIndex: 0, href: "OPS/chapter.xhtml" }, cfi, displayedQuote: quote });
    expect([selection.start, selection.end]).toEqual([10, 17]);
    annotations = new SqliteAnnotationRepository(sqlite);
    versions = new SqliteReadingStateVersionRepository(sqlite);
    const events = new ReadingStateEventBus(); published = jest.fn(); events.subscribe({ userId: 1, bookId: 1 }, published);
    const changes = new SqliteReadingStateChangeCoordinator(sqlite, events, versions);
    receipts = new SqliteAnnotationSelectionRepository(sqlite, annotations, selections, changes, versions);
    service = new ApplySelectionAnnotationUseCase(receipts, annotations, new BookContentSelectionAdapter(selections));
    command = { commandId: "command-1", requestDigest: "a".repeat(64), selection, appendText: "AI answer",
      target: { kind: "create", annotationType: "highlight", color: "#ff0", bookHash: "reader-book-hash", cfi } };
  });
  afterEach(() => { db.close(); rmSync(root, { recursive: true, force: true }); });

  it("creates atomically and replays the original success after annotation/book deletion", async () => {
    const result = await service.execute(1, command);
    expect(result.receipt.annotation.note).toBe("AI answer");
    expect(result.receipt.readingStateVersion).toBe(1);
    expect(published).toHaveBeenCalledTimes(1);
    db.prepare("DELETE FROM annotations WHERE id=?").run(result.receipt.annotation.id);
    db.exec("DELETE FROM books WHERE id=1");
    const replay = await service.execute(1, command);
    expect(replay).toEqual({ receipt: result.receipt, currentAnnotation: null, replayed: true });
    expect(published).toHaveBeenCalledTimes(1);
    expect(service.findReceipt(2, command.commandId)).toBeNull();
    await expect(service.execute(1, { ...command, requestDigest: "b".repeat(64) })).rejects.toMatchObject({ code: "ANNOTATION_COMMAND_CONFLICT" });
    db.exec("DELETE FROM users WHERE id=1");
    expect(service.findReceipt(1, command.commandId)).toBeNull();
  });
  it("appends to a different CFI spelling of the same canonical range; old trimmed labels remain valid", async () => {
    const created = await service.execute(1, command);
    const id = created.receipt.annotation.id;
    db.prepare("UPDATE annotations SET location=? WHERE id=?").run("epubcfi(/6/2!/4/6,/1:0,/1:7)", id);
    const result = await service.execute(1, { ...command, commandId: "append-1", appendText: "Second answer",
      target: { kind: "append", annotationId: id, expectedRevision: 1 } });
    expect(result.receipt.annotation.note).toBe("AI answer\n\nSecond answer");
    expect(result.receipt.annotation.revision).toBe(2);
    expect(result.receipt.readingStateVersion).toBe(2);
  });
  it("rejects identical text at a different physical range", async () => {
    const created = await service.execute(1, command), id = created.receipt.annotation.id;
    db.prepare("UPDATE annotations SET location=? WHERE id=?").run("epubcfi(/6/2!/4/4[first],/1:0,/1:7)", id);
    await expect(service.execute(1, { ...command, commandId: "wrong-place", target: { kind: "append", annotationId: id, expectedRevision: 1 } }))
      .rejects.toMatchObject({ code: "ANNOTATION_SELECTION_INVALID" });
    expect(annotations.findById(id)!.note).toBe("AI answer");
    expect(service.findReceipt(1, "wrong-place")).toBeNull();
  });
  it("fences an artifact pointer change immediately before the short write transaction", async () => {
    const commit = receipts.commit.bind(receipts);
    jest.spyOn(receipts, "commit").mockImplementation((userId, input, annotation) => {
      db.exec("DELETE FROM book_current_artifacts WHERE book_id=1; UPDATE book_artifacts SET status='retired' WHERE artifact_id='artifact-1'");
      db.prepare(`INSERT INTO book_artifacts (artifact_id,delivery_id,user_id,book_id,status,stored_path,file_name,mime_type,checksum,created_at,updated_at)
        VALUES ('artifact-2','delivery-2',1,1,'active','replacement.epub','fixture.epub','application/epub+zip',?,'now','now')`).run(checksum);
      db.exec("INSERT INTO book_current_artifacts VALUES (1,'artifact-2','now')");
      return commit(userId, input, annotation);
    });
    await expect(service.execute(1, command)).rejects.toMatchObject({ details: { reason: "CONTENT_REVISION_MISMATCH" } });
    expect(annotations.findByBook(1, 1)).toEqual([]);
    expect(versions.getRevision(1, 1)).toBe(0);
    expect(service.findReceipt(1, command.commandId)).toBeNull();
    expect(published).not.toHaveBeenCalled();
  });
  it.each(["location", "revision"])("rechecks annotation %s inside the transaction", async field => {
    const created = await service.execute(1, command), id = created.receipt.annotation.id;
    const commit = receipts.commit.bind(receipts);
    jest.spyOn(receipts, "commit").mockImplementation((userId, input, annotation) => {
      if (field === "location") db.prepare("UPDATE annotations SET location=? WHERE id=?").run("epubcfi(/6/2!/4/4[first],/1:0,/1:7)", id);
      else db.prepare("UPDATE annotations SET revision=revision+1 WHERE id=?").run(id);
      return commit(userId, input, annotation);
    });
    await expect(service.execute(1, { ...command, commandId: "racing-append", target: { kind: "append", annotationId: id, expectedRevision: 1 } }))
      .rejects.toMatchObject({ code: "ANNOTATION_CONFLICT" });
    expect(annotations.findById(id)!.note).toBe("AI answer");
    expect(versions.getRevision(1, 1)).toBe(1);
    expect(service.findReceipt(1, "racing-append")).toBeNull();
  });
  it("rolls back the annotation and receipt when reading-state version recording fails", async () => {
    db.exec("CREATE TRIGGER fail_version BEFORE INSERT ON reading_state_versions BEGIN SELECT RAISE(ABORT,'version failed'); END");
    await expect(service.execute(1, command)).rejects.toThrow("version failed");
    expect(annotations.findByBook(1, 1)).toEqual([]);
    expect(service.findReceipt(1, command.commandId)).toBeNull();
    expect(published).not.toHaveBeenCalled();
  });
  it("rejects another owner and a stale browser scope without adopting server versions", async () => {
    await expect(selections.resolveSelection(2, { scope: command.selection.scope, cfi, displayedQuote: quote }))
      .rejects.toMatchObject({ details: { reason: "BOOK_NOT_FOUND" } });
    await expect(selections.resolveSelection(1, { scope: { ...command.selection.scope, extractorVersion: "old" }, cfi, displayedQuote: quote }))
      .rejects.toMatchObject({ details: { reason: "CONTENT_REVISION_MISMATCH" } });
  });
  it("validates actual bytes and current scope before resolving a selection", async () => {
    writeFileSync(filePath, Buffer.from("changed bytes"));
    await expect(selections.resolveSelection(1, { scope: command.selection.scope, cfi, displayedQuote: quote }))
      .rejects.toMatchObject({ details: { reason: "CONTENT_REVISION_MISMATCH" } });
  });
});
