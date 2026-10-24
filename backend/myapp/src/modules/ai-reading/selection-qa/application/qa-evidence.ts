import { createHash } from "node:crypto";
import { SelectionQaError } from "./selection-qa.types";
import type { QaClaim, QaCurrentBook, QaEvidence, QaRuntimeStore, QaSavedEvidence } from "./selection-qa-runtime.port";
import { QaCoverage } from "../domain/qa-coverage";

export class QaEvidenceLedger {
  readonly items = new Map<string, QaSavedEvidence>();
  readonly coverage = new QaCoverage();
  constructor(private readonly claim: QaClaim, private readonly store: QaRuntimeStore) {}

  validate(e: QaEvidence): void {
    const scope = this.claim.conversation.selection.scope;
    const revision = e.locator.contentRevision;
    const position = e.locator.position;
    if (e.locator.version !== 1 || e.locator.bookId !== this.claim.conversation.bookId ||
        revision.fileChecksum !== scope.fileChecksum || revision.extractorVersion !== scope.extractorVersion ||
        revision.normalizationVersion !== scope.normalizationVersion || position.kind !== "epub_text" ||
        position.sectionIndex !== e.sectionIndex || position.start !== e.start || position.end !== e.end ||
        !Number.isSafeInteger(e.start) || !Number.isSafeInteger(e.end) || e.start < 0 || e.end <= e.start ||
        e.end - e.start !== e.quote.length || !e.cfi || !e.href ||
        e.quoteHash !== createHash("sha256").update(e.quote).digest("hex"))
      throw new SelectionQaError("EVIDENCE_INVALID");
  }

  save(e: QaEvidence, from?: string): QaSavedEvidence {
    this.validate(e);
    const id = "e_" + createHash("sha256").update(JSON.stringify([this.claim.turn.id, e.locator, e.quoteHash])).digest("hex").slice(0, 20);
    const existing = this.items.get(id);
    if (existing) return existing;
    const saved = { ...e, evidenceId: id, ...(from ? { importedFromTurnId: from } : {}) };
    this.store.evidence(this.claim, saved);
    this.items.set(id, saved);
    this.coverage.record(saved);
    return saved;
  }

  require(id: string): QaSavedEvidence {
    const item = this.items.get(id);
    if (!item) throw new SelectionQaError("EVIDENCE_INVALID");
    return item;
  }
}

export function qaEvidenceResult(e: QaSavedEvidence, sourceBook: QaCurrentBook) {
  return { sourceBook, evidenceId: e.evidenceId, sectionIndex: e.sectionIndex, href: e.href,
    start: e.start, end: e.end, text: e.quote, contextTruncated: e.contextTruncated === true };
}
