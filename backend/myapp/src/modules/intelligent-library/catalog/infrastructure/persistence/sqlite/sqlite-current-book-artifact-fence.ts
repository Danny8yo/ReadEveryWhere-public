import { Injectable } from "@nestjs/common";
import { SqliteService } from "../../../../../../platform/persistence/sqlite/sqlite.service";
import type { CurrentBookArtifactFencePort, CurrentBookArtifactIdentity } from "../../../../public/current-book-artifact-fence.port";
import { ReaderToolException } from "../../../../public/reader-tool-error";

@Injectable()
export class SqliteCurrentBookArtifactFence implements CurrentBookArtifactFencePort {
  constructor(private readonly sqlite: SqliteService) {}
  current(userId: number, bookId: number): CurrentBookArtifactIdentity | null {
    const row = this.sqlite.getDatabase().prepare(`
      SELECT a.artifact_id, a.checksum FROM book_current_artifacts c
      JOIN book_artifacts a ON a.artifact_id = c.artifact_id
      JOIN books b ON b.id = c.book_id AND b.user_id = a.user_id
      WHERE c.book_id = ? AND a.user_id = ? AND a.book_id = ? AND a.status = 'active'
    `).get(bookId, userId, bookId) as { artifact_id: string; checksum: string | null } | undefined;
    if (!row) return null;
    if (!row.checksum || !/^(?:sha256:)?[a-f0-9]{64}$/i.test(row.checksum))
      throw new ReaderToolException("CONTENT_REVISION_MISMATCH", "Current artifact has no valid SHA-256 identity");
    return { bookId, artifactId: row.artifact_id, fileChecksum: `sha256:${row.checksum.replace(/^sha256:/, "")}` };
  }
  assertCurrent(userId: number, expected: CurrentBookArtifactIdentity): void {
    const current = this.current(userId, expected.bookId);
    if (!current || current.artifactId !== expected.artifactId || current.fileChecksum !== expected.fileChecksum)
      throw new ReaderToolException("CONTENT_REVISION_MISMATCH", "The book artifact changed; select again");
  }
}
