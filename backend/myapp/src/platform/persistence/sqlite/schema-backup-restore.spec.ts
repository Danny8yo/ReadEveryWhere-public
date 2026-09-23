import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { BASELINE_SCHEMA } from './schema-baseline';
import { SELECTION_QA_SCHEMA } from './schema-selection-qa';
import { KEYWORD_INDEX_SCHEMA } from './schema-index';
import { initializeSchema } from './schema-migrations';
import { seedUpgradeFixture, snapshotLegacy } from './schema-upgrade.fixture';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

describe('isolated WAL backup, v3 upgrade and paired restore', () => {
  it('preserves data and receipts, rolls back v4 failure, and restores the matching database/file backup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rew-p6-restore-'));
    const opened: DatabaseSync[] = [];
    const open = (path: string) => {
      const db = new DatabaseSync(path);
      opened.push(db);
      db.exec('PRAGMA foreign_keys=ON');
      return db;
    };
    try {
      const source = open(join(dir, 'source.sqlite'));
      source.exec('PRAGMA journal_mode=WAL');
      source.exec(BASELINE_SCHEMA + SELECTION_QA_SCHEMA + KEYWORD_INDEX_SCHEMA);
      seedUpgradeFixture(source);
      source.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)');
      [BASELINE_SCHEMA, SELECTION_QA_SCHEMA, KEYWORD_INDEX_SCHEMA].forEach((sql, index) => {
        source.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(index + 1, digest(sql), 100);
      });
      source.exec(`
        INSERT INTO selection_qa_conversations VALUES('qa',1,1,'{}','active',NULL,'原问题',100,100);
        INSERT INTO selection_qa_turns(id,user_id,conversation_id,turn_number,question,answer,status,deadline,last_sequence,created_at,updated_at)
          VALUES('done',1,'qa',1,'历史问题','完整历史回答','completed',60000,1,100,100),
                ('queued',1,'qa',2,'待回答问题','','queued',60000,1,100,100);
        INSERT INTO selection_qa_events VALUES('done',1,1,'terminal','{"status":"completed"}',100),
          ('queued',1,1,'status','{"status":"queued"}',100);
        INSERT INTO selection_qa_evidence VALUES('done',1,'e-old','book','{"quote":"历史证据"}');
        INSERT INTO selection_qa_commands VALUES(1,'qa-command','digest','{"turnId":"done"}',100);
        INSERT INTO annotation_selection_commands VALUES(1,'note-command','digest','{"annotationId":"annotation","revision":2}',100);
      `);
      const book = join(dir, 'book.epub');
      // Synthetic bytes suffice here: this test verifies paired storage, not EPUB parsing.
      writeFileSync(book, 'self-authored-book-version-one');
      source.prepare('UPDATE book_artifacts SET checksum=?').run(digest(readFileSync(book)));
      const before = snapshotLegacy(source);
      const ledger = source.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
      const receipt = source.prepare('SELECT * FROM annotation_selection_commands').all();
      const completed = source.prepare('SELECT answer,status,last_sequence FROM selection_qa_turns WHERE id=?').get('done');

      // Application writes are quiescent; Backup API includes committed WAL contents.
      const backupDir = join(dir, 'consistent-backup');
      mkdirSync(backupDir);
      const snapshot = join(backupDir, 'database.sqlite');
      await backup(source, snapshot);
      copyFileSync(book, join(backupDir, 'book.epub'));
      const snapshotHash = digest(readFileSync(snapshot));
      const candidatePath = join(dir, 'candidate.sqlite');
      copyFileSync(snapshot, candidatePath);
      const candidate = open(candidatePath);
      expect(() => initializeSchema(candidate, version => {
        if (version === 4) throw new Error('injected-v4-failure');
      })).toThrow('injected-v4-failure');
      expect(candidate.prepare('SELECT * FROM schema_migrations ORDER BY version').all()).toEqual(ledger);
      expect(candidate.prepare('PRAGMA table_info(selection_qa_turns)').all().some(c => c.name === 'phase')).toBe(false);
      expect(candidate.prepare("SELECT status,last_sequence FROM selection_qa_turns WHERE id='queued'").get()).toEqual({ status: 'queued', last_sequence: 1 });

      initializeSchema(candidate);
      initializeSchema(candidate);
      expect(snapshotLegacy(candidate)).toEqual(before);
      expect(candidate.prepare('SELECT * FROM schema_migrations WHERE version<=3 ORDER BY version').all()).toEqual(ledger);
      expect(candidate.prepare('SELECT * FROM annotation_selection_commands').all()).toEqual(receipt);
      expect(candidate.prepare('SELECT answer,status,last_sequence FROM selection_qa_turns WHERE id=?').get('done')).toEqual(completed);
      expect(candidate.prepare('SELECT phase FROM selection_qa_turns WHERE id=?').get('done')!.phase).toBe('terminal');
      expect(candidate.prepare("SELECT status,error_code,last_sequence FROM selection_qa_turns WHERE id='queued'").get()).toEqual({ status: 'failed', error_code: 'EXECUTION_NOT_CONFIGURED', last_sequence: 2 });
      expect(candidate.prepare("SELECT COUNT(*) n FROM selection_qa_events WHERE turn_id='queued' AND kind='terminal'").get()!.n).toBe(1);
      expect(candidate.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(candidate.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');

      // A rollback is an explicit backup restore, never an assumed image rollback.
      const upgradedBook = join(dir, 'upgraded.epub');
      writeFileSync(upgradedBook, 'newer-book-version');
      candidate.prepare("UPDATE annotations SET note='post-upgrade write'").run();
      const restoreDir = join(dir, 'restored');
      mkdirSync(restoreDir);
      copyFileSync(snapshot, join(restoreDir, 'database.sqlite'));
      copyFileSync(join(backupDir, 'book.epub'), join(restoreDir, 'book.epub'));
      const restored = open(join(restoreDir, 'database.sqlite'));
      expect(snapshotLegacy(restored)).toEqual(before);
      expect(restored.prepare('SELECT * FROM schema_migrations ORDER BY version').all()).toEqual(ledger);
      expect(restored.prepare('SELECT * FROM annotation_selection_commands').all()).toEqual(receipt);
      expect(restored.prepare('SELECT checksum FROM book_artifacts').get()!.checksum).toBe(digest(readFileSync(join(restoreDir, 'book.epub'))));
      expect(restored.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(restored.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');
      expect(snapshotLegacy(source)).toEqual(before);
      expect(digest(readFileSync(snapshot))).toBe(snapshotHash);
    } finally {
      for (const db of opened.reverse()) db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
