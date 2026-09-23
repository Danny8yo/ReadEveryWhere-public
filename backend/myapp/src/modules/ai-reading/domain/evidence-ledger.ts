import { createHash } from 'node:crypto';
import { BookScope, BookScopeJSON } from './book-scope';
import {
  AiReadingDomainError,
  jsonClone,
  requireIsoDate,
  requireNonEmpty,
} from './domain-error';

export interface BookCitation {
  bookId: string;
  contentRevision: string;
  locator: unknown;
  [key: string]: unknown;
}

export interface BookReadEvidenceInput {
  evidenceId: string;
  taskId: string;
  agentRunId: string;
  scope: BookScope;
  quote: string;
  bookRead: {
    text: string;
    citation: BookCitation;
  };
  createdAt: string;
}

export interface EvidenceRecord {
  evidenceId: string;
  taskId: string;
  agentRunId: string;
  scope: BookScopeJSON;
  quote: string;
  citation: BookCitation;
  sourceTool: 'book_read';
  sourceTextHash: string;
  createdAt: string;
}

export interface EvidenceLedgerJSON {
  taskId: string;
  scope: BookScopeJSON;
  evidence: EvidenceRecord[];
}

function cloneRecord(record: EvidenceRecord): EvidenceRecord {
  return jsonClone(record, 'EVIDENCE_INVALID');
}

const MAX_EVIDENCE_QUOTE_CHARACTERS = 1_500;

export class EvidenceLedger {
  private readonly records = new Map<string, EvidenceRecord>();

  private constructor(
    public readonly taskId: string,
    public readonly scope: BookScope,
  ) {}

  static create(taskId: string, scope: BookScope): EvidenceLedger {
    requireNonEmpty(taskId, 'EVIDENCE_LEDGER_INVALID', 'taskId');
    return new EvidenceLedger(taskId, scope);
  }

  static fromJSON(value: EvidenceLedgerJSON): EvidenceLedger {
    if (!value || typeof value !== 'object' || !Array.isArray(value.evidence)) {
      throw new AiReadingDomainError(
        'EVIDENCE_STATE_INVALID',
        'persisted evidence ledger must contain an evidence array',
      );
    }
    const ledger = EvidenceLedger.create(
      value.taskId,
      BookScope.fromJSON(value.scope),
    );
    for (const record of value.evidence) {
      ledger.restoreRecord(record);
    }
    return ledger;
  }

  recordBookRead(input: BookReadEvidenceInput): EvidenceRecord {
    requireNonEmpty(input.evidenceId, 'EVIDENCE_INVALID', 'evidenceId');
    requireNonEmpty(input.agentRunId, 'EVIDENCE_INVALID', 'agentRunId');
    requireNonEmpty(input.quote, 'EVIDENCE_INVALID', 'quote');
    requireIsoDate(input.createdAt, 'EVIDENCE_INVALID', 'createdAt');
    if (input.quote.length > MAX_EVIDENCE_QUOTE_CHARACTERS) {
      throw new AiReadingDomainError(
        'EVIDENCE_INVALID',
        `quote must not exceed ${MAX_EVIDENCE_QUOTE_CHARACTERS} characters`,
      );
    }
    if (input.taskId !== this.taskId) {
      throw new AiReadingDomainError(
        'EVIDENCE_TASK_MISMATCH',
        'evidence belongs to another task',
      );
    }
    if (!this.scope.equals(input.scope)) {
      throw new AiReadingDomainError(
        'EVIDENCE_SCOPE_MISMATCH',
        'evidence is outside the task book scope',
      );
    }
    if (
      input.bookRead.citation.bookId !== this.scope.bookId ||
      input.bookRead.citation.contentRevision !== this.scope.contentRevision
    ) {
      throw new AiReadingDomainError(
        'EVIDENCE_CITATION_SCOPE_MISMATCH',
        'citation does not match the task book revision',
      );
    }
    if (!isPersistedLocator(input.bookRead.citation.locator)) {
      throw new AiReadingDomainError(
        'EVIDENCE_CITATION_INVALID',
        'citation locator is malformed or cannot be replayed safely',
      );
    }
    if (!input.bookRead.text.includes(input.quote)) {
      throw new AiReadingDomainError(
        'EVIDENCE_QUOTE_NOT_IN_SOURCE',
        'quote must be an exact substring of the book_read response',
      );
    }
    const record: EvidenceRecord = {
      evidenceId: input.evidenceId,
      taskId: input.taskId,
      agentRunId: input.agentRunId,
      scope: input.scope.toJSON(),
      quote: input.quote,
      citation: jsonClone(input.bookRead.citation, 'EVIDENCE_INVALID'),
      sourceTool: 'book_read',
      sourceTextHash: createHash('sha256')
        .update(input.bookRead.text, 'utf8')
        .digest('hex'),
      createdAt: input.createdAt,
    };
    const existing = this.records.get(record.evidenceId);
    if (existing) {
      if (JSON.stringify(existing) === JSON.stringify(record)) {
        return cloneRecord(existing);
      }
      throw new AiReadingDomainError(
        'EVIDENCE_ID_CONFLICT',
        'evidence id was already used for different evidence',
        { evidenceId: record.evidenceId },
      );
    }
    this.records.set(record.evidenceId, record);
    return cloneRecord(record);
  }

  requireOwned(evidenceIds: readonly string[]): EvidenceRecord[] {
    return evidenceIds.map((evidenceId) => {
      const evidence = this.records.get(evidenceId);
      if (!evidence || evidence.taskId !== this.taskId) {
        throw new AiReadingDomainError(
          'EVIDENCE_NOT_OWNED',
          'result references evidence outside this task',
          { evidenceId },
        );
      }
      return cloneRecord(evidence);
    });
  }

  assertBoundTo(taskId: string, scope: BookScope): void {
    if (taskId !== this.taskId || !scope.equals(this.scope)) {
      throw new AiReadingDomainError(
        'EVIDENCE_LEDGER_SCOPE_MISMATCH',
        'evidence ledger does not belong to this task scope',
      );
    }
  }

  toJSON(): EvidenceLedgerJSON {
    return {
      taskId: this.taskId,
      scope: this.scope.toJSON(),
      evidence: [...this.records.values()].map(cloneRecord),
    };
  }

  private restoreRecord(record: EvidenceRecord): void {
    if (!record || typeof record !== 'object') this.invalidPersistedRecord();

    let restoredScope: BookScope;
    try {
      requireNonEmpty(record.evidenceId, 'EVIDENCE_STATE_INVALID', 'evidenceId');
      requireNonEmpty(record.agentRunId, 'EVIDENCE_STATE_INVALID', 'agentRunId');
      requireNonEmpty(record.quote, 'EVIDENCE_STATE_INVALID', 'quote');
      requireIsoDate(record.createdAt, 'EVIDENCE_STATE_INVALID', 'createdAt');
      restoredScope = BookScope.fromJSON(record.scope);
    } catch {
      this.invalidPersistedRecord();
    }

    if (
      record.taskId !== this.taskId ||
      !this.scope.equals(restoredScope!) ||
      record.sourceTool !== 'book_read' ||
      record.quote.length > MAX_EVIDENCE_QUOTE_CHARACTERS ||
      !isRecord(record.citation) ||
      record.citation.bookId !== this.scope.bookId ||
      record.citation.contentRevision !== this.scope.contentRevision ||
      !isPersistedLocator(record.citation.locator) ||
      typeof record.sourceTextHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(record.sourceTextHash)
    ) {
      this.invalidPersistedRecord();
    }
    if (this.records.has(record.evidenceId)) {
      throw new AiReadingDomainError(
        'EVIDENCE_ID_CONFLICT',
        'persisted evidence contains a duplicate id',
      );
    }

    // The source body is deliberately not persisted. Recovery can validate
    // ownership, structure and hash format, but cannot recompute the hash or
    // re-check the quote substring without replaying book_read.
    this.records.set(record.evidenceId, cloneRecord(record));
  }

  private invalidPersistedRecord(): never {
    throw new AiReadingDomainError(
      'EVIDENCE_STATE_INVALID',
      'persisted evidence violates the ledger boundary',
    );
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPersistedLocator(value: unknown): boolean {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.position)) return false;
  const position = value.position;
  if (
    position.kind !== 'epub_text' ||
    !isNonNegativeSafeInteger(position.sectionIndex) ||
    !isNonNegativeSafeInteger(position.start) ||
    !isNonNegativeSafeInteger(position.end) ||
    position.end < position.start
  ) return false;

  if (value.textQuote !== undefined) {
    if (!isRecord(value.textQuote) || typeof value.textQuote.exact !== 'string') return false;
    if (value.textQuote.exact.length > 256) return false;
    if (value.textQuote.prefix !== undefined
      && (typeof value.textQuote.prefix !== 'string' || value.textQuote.prefix.length > 128)) return false;
    if (value.textQuote.suffix !== undefined
      && (typeof value.textQuote.suffix !== 'string' || value.textQuote.suffix.length > 128)) return false;
  }
  if (value.structure !== undefined) {
    if (!isRecord(value.structure)) return false;
    const limits: Record<string, number> = {
      tocNodeId: 128,
      href: 1_024,
      fragment: 512,
      label: 500,
      path: 2_000,
    };
    for (const [field, maxLength] of Object.entries(limits)) {
      if (value.structure[field] !== undefined
        && (typeof value.structure[field] !== 'string'
          || value.structure[field].length > maxLength)) return false;
    }
  }
  if (value.readerAnchor !== undefined) {
    if (!isRecord(value.readerAnchor)) return false;
    if (value.readerAnchor.epubcfi !== undefined
      && (typeof value.readerAnchor.epubcfi !== 'string'
        || value.readerAnchor.epubcfi.length > 10_000)) return false;
  }
  return true;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
