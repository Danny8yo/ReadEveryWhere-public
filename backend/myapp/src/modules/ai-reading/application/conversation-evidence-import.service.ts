import { randomUUID } from 'node:crypto';
import type {
  ContentRevision,
  EpubBookLocatorV1,
  ReadingToolsPort,
} from './ports/reading-tools.port';
import { AiReadingDomainError } from '../domain';
import type { AgentRunWriteAuthority } from './ports/agent-run-store.port';
import type { ConversationStorePort } from './ports/conversation-store.port';
import type { EvidenceStorePort, PersistedEvidenceRecord } from './ports/evidence-store.port';

const STABLE_SOURCE_STATUSES = new Set(['completed', 'partial', 'needs_input']);
const TERMINAL_SOURCE_STATUSES = new Set([
  ...STABLE_SOURCE_STATUSES,
  'failed',
  'cancelled',
]);

export class ConversationEvidenceImportService {
  constructor(
    private readonly conversations: Pick<
      ConversationStorePort,
      'findForUser' | 'findTurnForUser' | 'findTurnByTaskId'
    >,
    private readonly evidence: Pick<EvidenceStorePort, 'findForTask' | 'findImportedForTask' | 'append'>,
    private readonly readingTools: Pick<ReadingToolsPort, 'replayRange'>,
    private readonly createId: () => string = randomUUID,
  ) {}

  async importEvidence(input: {
    userId: number;
    conversationId: string;
    sourceTurnId: string;
    targetTaskId: string;
    targetAgentRunId: string;
    evidenceIds: string[];
    authority: AgentRunWriteAuthority;
    now: string;
  }): Promise<PersistedEvidenceRecord[]> {
    const conversation = this.conversations.findForUser(input.conversationId, input.userId);
    if (!conversation) this.fail('CONVERSATION_NOT_FOUND', 'conversation was not found');
    const sourceTurn = this.conversations.findTurnForUser(
      input.conversationId,
      input.sourceTurnId,
      input.userId,
    );
    const targetTurn = this.conversations.findTurnByTaskId(input.targetTaskId);
    if (!sourceTurn || sourceTurn.conversationId !== input.conversationId
      || !targetTurn || targetTurn.conversationId !== input.conversationId
      || targetTurn.taskId !== input.targetTaskId) {
      this.fail('EVIDENCE_IMPORT_SCOPE_MISMATCH', 'source and target must belong to the same conversation');
    }
    if (!TERMINAL_SOURCE_STATUSES.has(sourceTurn.status)) {
      this.fail('EVIDENCE_IMPORT_SOURCE_NOT_TERMINAL', 'source turn must be terminal');
    }
    const directRetry = targetTurn.retryOfTurnId === sourceTurn.id;
    if (!STABLE_SOURCE_STATUSES.has(sourceTurn.status) && !directRetry) {
      this.fail('EVIDENCE_IMPORT_SOURCE_NOT_STABLE', 'failed or cancelled evidence is not stable context');
    }
    if (input.authority.lease.agentRunId !== input.targetAgentRunId) {
      this.fail('EVIDENCE_IMPORT_AUTHORITY_MISMATCH', 'agent lease does not own the target run');
    }
    if (new Set(input.evidenceIds).size !== input.evidenceIds.length
      || input.evidenceIds.length === 0 || input.evidenceIds.length > 20) {
      this.fail('EVIDENCE_IMPORT_REQUEST_INVALID', 'evidenceIds must contain one to twenty unique ids');
    }

    const revision = parseRevision(conversation.contentRevision);
    const prepared: PersistedEvidenceRecord[] = [];
    for (const evidenceId of input.evidenceIds) {
      const source = this.evidence.findForTask(sourceTurn.taskId, evidenceId);
      if (!source) this.fail('EVIDENCE_IMPORT_SOURCE_NOT_FOUND', 'source evidence is not owned by the source turn');
      if (!source.sourceLocator) {
        this.fail('EVIDENCE_IMPORT_SOURCE_LEGACY', 'legacy evidence has no replayable source range');
      }
      if (String(source.citation.bookId) !== conversation.bookId
        || source.citation.contentRevision !== conversation.contentRevision
        || !isLocator(source.sourceLocator)
        || source.sourceLocator.bookId !== Number(conversation.bookId)
        || !sameRevision(source.sourceLocator.contentRevision, revision)) {
        this.fail('EVIDENCE_IMPORT_SCOPE_MISMATCH', 'source evidence is outside the conversation book revision');
      }

      const replayed = await this.readingTools.replayRange(input.userId, {
        bookId: Number(conversation.bookId),
        contentRevision: revision,
        sourceLocator: source.sourceLocator,
      });
      if (replayed.text !== source.quote || replayed.sourceTextHash !== source.sourceTextHash) {
        this.fail('EVIDENCE_IMPORT_REPLAY_MISMATCH', 'source quote or hash changed during replay');
      }
      prepared.push({
        evidenceId: this.createId(),
        taskId: input.targetTaskId,
        agentRunId: input.targetAgentRunId,
        quote: source.quote,
        citation: {
          ...replayed.citation,
          bookId: conversation.bookId,
          contentRevision: conversation.contentRevision,
          locator: replayed.citation.locator,
        },
        sourceTextHash: replayed.sourceTextHash,
        sourceLocator: replayed.citation.locator,
        provenanceKind: 'conversation_import',
        sourceTaskId: sourceTurn.taskId,
        sourceEvidenceId: source.evidenceId,
        createdAt: input.now,
      });
    }

    const imported: PersistedEvidenceRecord[] = [];
    for (const record of prepared) {
      const result = this.evidence.append(record, input.authority);
      if (result === 'fenced') {
        this.fail('AGENT_RUN_FENCED', 'agent lease expired before evidence import');
      }
      if (result === 'existing') {
        const existing = this.evidence.findImportedForTask(
          record.taskId,
          record.sourceTaskId!,
          record.sourceEvidenceId!,
        );
        if (!existing) {
          this.fail('EVIDENCE_IMPORT_STATE_INVALID', 'existing import provenance could not be loaded');
        }
        imported.push(existing);
        continue;
      }
      imported.push(record);
    }
    return imported;
  }

  private fail(code: string, message: string): never {
    throw new AiReadingDomainError(code, message);
  }
}

function parseRevision(value: string): ContentRevision {
  try {
    const revision = JSON.parse(value) as ContentRevision;
    if (!revision || typeof revision.fileChecksum !== 'string'
      || typeof revision.extractorVersion !== 'string'
      || typeof revision.normalizationVersion !== 'string') throw new Error('invalid');
    return revision;
  } catch {
    throw new AiReadingDomainError('EVIDENCE_IMPORT_SCOPE_MISMATCH', 'conversation revision is invalid');
  }
}

function isLocator(value: unknown): value is EpubBookLocatorV1 {
  if (!value || typeof value !== 'object') return false;
  const locator = value as Partial<EpubBookLocatorV1>;
  return locator.version === 1
    && Number.isInteger(locator.bookId)
    && Boolean(locator.contentRevision)
    && locator.position?.kind === 'epub_text'
    && Number.isSafeInteger(locator.position.sectionIndex)
    && Number.isSafeInteger(locator.position.start)
    && Number.isSafeInteger(locator.position.end)
    && locator.position.start >= 0
    && locator.position.end > locator.position.start;
}

function sameRevision(left: ContentRevision, right: ContentRevision): boolean {
  return left.fileChecksum === right.fileChecksum
    && left.extractorVersion === right.extractorVersion
    && left.normalizationVersion === right.normalizationVersion;
}
