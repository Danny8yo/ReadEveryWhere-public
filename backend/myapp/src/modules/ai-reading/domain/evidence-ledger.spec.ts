import { BookScope } from './book-scope';
import { EvidenceLedger } from './evidence-ledger';

const scope = BookScope.create({
  userId: 'user-1',
  bookId: 'book-1',
  contentRevision: 'rev-1',
});

function validInput() {
  return {
    evidenceId: 'evidence-1',
    taskId: 'task-1',
    agentRunId: 'child-1',
    scope,
    quote: 'the exact quoted sentence',
    bookRead: {
      text: 'Before the exact quoted sentence and after.',
      citation: {
        bookId: 'book-1',
        contentRevision: 'rev-1',
        locator: {
          version: 1,
          position: {
            kind: 'epub_text',
            sectionIndex: 3,
            start: 7,
            end: 32,
          },
        },
      },
    },
    createdAt: '2026-08-06T00:00:00.000Z',
  };
}

describe('EvidenceLedger', () => {
  it('accepts an exact substring from book_read and stores no full source text', () => {
    const ledger = EvidenceLedger.create('task-1', scope);
    const evidence = ledger.recordBookRead(validInput());

    expect(evidence.quote).toBe('the exact quoted sentence');
    expect(evidence.sourceTextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(ledger.toJSON())).not.toContain(
      'Before the exact quoted sentence and after.',
    );
  });

  it('rejects cross-task, cross-scope and fabricated evidence', () => {
    const ledger = EvidenceLedger.create('task-1', scope);

    expect(() =>
      ledger.recordBookRead({ ...validInput(), taskId: 'task-2' }),
    ).toThrow('EVIDENCE_TASK_MISMATCH');
    expect(() =>
      ledger.recordBookRead({
        ...validInput(),
        scope: BookScope.create({
          userId: 'user-1',
          bookId: 'book-1',
          contentRevision: 'rev-2',
        }),
      }),
    ).toThrow('EVIDENCE_SCOPE_MISMATCH');
    expect(() =>
      ledger.recordBookRead({ ...validInput(), quote: 'invented quote' }),
    ).toThrow('EVIDENCE_QUOTE_NOT_IN_SOURCE');
  });

  it('rejects a citation for another revision even if the supplied scope matches', () => {
    const ledger = EvidenceLedger.create('task-1', scope);

    expect(() =>
      ledger.recordBookRead({
        ...validInput(),
        bookRead: {
          ...validInput().bookRead,
          citation: {
            ...validInput().bookRead.citation,
            contentRevision: 'rev-other',
          },
        },
      }),
    ).toThrow('EVIDENCE_CITATION_SCOPE_MISMATCH');
  });

  it('rejects malformed or non-replayable locators before persisting evidence', () => {
    const ledger = EvidenceLedger.create('task-1', scope);
    const malformed = validInput();
    malformed.bookRead.citation.locator.position.end = 6;
    expect(() => ledger.recordBookRead(malformed)).toThrow('EVIDENCE_CITATION_INVALID');

    const oversizedTextQuote = validInput();
    Object.assign(oversizedTextQuote.bookRead.citation.locator, {
      textQuote: { exact: 'x'.repeat(257) },
    });
    expect(() => ledger.recordBookRead(oversizedTextQuote)).toThrow('EVIDENCE_CITATION_INVALID');
  });

  it('validates that result references belong to this task', () => {
    const ledger = EvidenceLedger.create('task-1', scope);
    ledger.recordBookRead(validInput());

    expect(ledger.requireOwned(['evidence-1'])).toHaveLength(1);
    expect(() => ledger.requireOwned(['evidence-from-another-task'])).toThrow(
      'EVIDENCE_NOT_OWNED',
    );
  });

  it('is idempotent for the same evidence and rejects conflicting reuse of an id', () => {
    const ledger = EvidenceLedger.create('task-1', scope);
    const first = ledger.recordBookRead(validInput());

    expect(ledger.recordBookRead(validInput())).toEqual(first);
    expect(() =>
      ledger.recordBookRead({
        ...validInput(),
        quote: 'quoted sentence',
      }),
    ).toThrow('EVIDENCE_ID_CONFLICT');
  });

  it('restores records only after validating every persisted invariant', () => {
    const ledger = EvidenceLedger.create('task-1', scope);
    ledger.recordBookRead(validInput());
    const persisted = ledger.toJSON();

    expect(EvidenceLedger.fromJSON(persisted).toJSON()).toEqual(persisted);

    const invalidRecords: Array<[string, (value: any) => void]> = [
      ['evidenceId', (value) => { value.evidence[0].evidenceId = ' '; }],
      ['agentRunId', (value) => { value.evidence[0].agentRunId = ''; }],
      ['createdAt', (value) => { value.evidence[0].createdAt = 'not-a-date'; }],
      ['sourceTool', (value) => { value.evidence[0].sourceTool = 'book_search_text'; }],
      ['taskId', (value) => { value.evidence[0].taskId = 'task-2'; }],
      ['scope', (value) => { value.evidence[0].scope.contentRevision = 'rev-2'; }],
      ['citation.bookId', (value) => { value.evidence[0].citation.bookId = 'book-2'; }],
      ['citation.contentRevision', (value) => { value.evidence[0].citation.contentRevision = 'rev-2'; }],
      ['quote', (value) => { value.evidence[0].quote = ' '; }],
      ['quote length', (value) => { value.evidence[0].quote = 'x'.repeat(1_501); }],
      ['locator object', (value) => { value.evidence[0].citation.locator = null; }],
      ['locator version', (value) => { value.evidence[0].citation.locator.version = 2; }],
      ['locator position', (value) => { delete value.evidence[0].citation.locator.position; }],
      ['locator range', (value) => { value.evidence[0].citation.locator.position.end = 6; }],
      ['text quote length', (value) => {
        value.evidence[0].citation.locator.textQuote = { exact: 'x'.repeat(257) };
      }],
      ['structure length', (value) => {
        value.evidence[0].citation.locator.structure = { href: 'x'.repeat(1_025) };
      }],
      ['reader anchor length', (value) => {
        value.evidence[0].citation.locator.readerAnchor = { epubcfi: 'x'.repeat(10_001) };
      }],
      ['sourceTextHash', (value) => { value.evidence[0].sourceTextHash = 'not-a-sha256'; }],
    ];

    for (const [, mutate] of invalidRecords) {
      const invalid = JSON.parse(JSON.stringify(persisted));
      mutate(invalid);
      expect(
        () => EvidenceLedger.fromJSON(invalid),
      ).toThrow('EVIDENCE_STATE_INVALID');
    }
  });

  it('rejects malformed evidence collections and duplicate persisted IDs', () => {
    const ledger = EvidenceLedger.create('task-1', scope);
    ledger.recordBookRead(validInput());
    const persisted = ledger.toJSON();

    expect(() => EvidenceLedger.fromJSON({
      ...persisted,
      evidence: null,
    } as unknown as Parameters<typeof EvidenceLedger.fromJSON>[0])).toThrow('EVIDENCE_STATE_INVALID');

    expect(() => EvidenceLedger.fromJSON({
      ...persisted,
      evidence: [persisted.evidence[0], persisted.evidence[0]],
    })).toThrow('EVIDENCE_ID_CONFLICT');
  });

  it('can validate only persisted invariants because the source text is intentionally absent', () => {
    const ledger = EvidenceLedger.create('task-1', scope);
    ledger.recordBookRead(validInput());
    const persisted = ledger.toJSON();

    persisted.evidence[0].sourceTextHash = 'a'.repeat(64);

    expect(EvidenceLedger.fromJSON(persisted).toJSON().evidence[0].sourceTextHash)
      .toBe('a'.repeat(64));
  });
});
