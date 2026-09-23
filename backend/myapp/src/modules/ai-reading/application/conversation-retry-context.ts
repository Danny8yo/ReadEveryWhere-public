import type { PersistedEvidenceRecord } from './ports/evidence-store.port';

const MAX_CANDIDATES = 20;
const MAX_QUOTE_PREVIEW_CHARACTERS = 240;

export interface ConversationRetryEvidenceCandidate {
  sourceEvidenceId: string;
  chapterPath: string | null;
  quotePreview: string;
}

export interface ConversationRetryContext {
  sourceTurnId: string;
  sourceStatus: 'failed' | 'cancelled';
  failureCode: string;
  evidenceCandidates: ConversationRetryEvidenceCandidate[];
}

export function buildConversationRetryContext(input: {
  sourceTurnId: string;
  sourceStatus: 'failed' | 'cancelled';
  terminalReason?: string;
  bookId: string;
  contentRevision: string;
  evidence: PersistedEvidenceRecord[];
}): ConversationRetryContext {
  return {
    sourceTurnId: input.sourceTurnId,
    sourceStatus: input.sourceStatus,
    failureCode: publicFailureCode(input.sourceStatus, input.terminalReason),
    evidenceCandidates: input.evidence
      .filter((item) => Boolean(item.sourceLocator)
        && item.citation.bookId === input.bookId
        && item.citation.contentRevision === input.contentRevision)
      .slice(0, MAX_CANDIDATES)
      .map((item) => ({
        sourceEvidenceId: item.evidenceId,
        chapterPath: typeof item.citation.chapterPath === 'string'
          ? item.citation.chapterPath.slice(0, 500)
          : null,
        quotePreview: preview(item.quote),
      })),
  };
}

function publicFailureCode(status: 'failed' | 'cancelled', value?: string): string {
  const normalized = value?.trim();
  if (normalized === 'user_cancelled') return 'USER_CANCELLED';
  if (normalized && /^[A-Z][A-Z0-9_]{1,63}$/.test(normalized)) return normalized;
  return status === 'failed' ? 'TURN_FAILED' : 'TURN_CANCELLED';
}

function preview(value: string): string {
  if (value.length <= MAX_QUOTE_PREVIEW_CHARACTERS) return value;
  return `${value.slice(0, MAX_QUOTE_PREVIEW_CHARACTERS - 1)}…`;
}
