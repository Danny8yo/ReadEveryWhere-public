import { createHash } from 'node:crypto';
import type { AgentRunWriteAuthority } from './ports/agent-run-store.port';
import { ConversationEvidenceImportService } from './conversation-evidence-import.service';

const REVISION = { fileChecksum: 'sha256:v1', extractorVersion: 'epub-1', normalizationVersion: 'text-1' };
const SERIALIZED_REVISION = JSON.stringify(REVISION);
const LOCATOR = {
  version: 1 as const, bookId: 42, contentRevision: REVISION,
  position: { kind: 'epub_text' as const, sectionIndex: 3, start: 10, end: 18 },
  textQuote: { exact: '原文证据' },
};

describe('ConversationEvidenceImportService', () => {
  it('replays a same-conversation terminal source and creates current-task evidence with provenance', async () => {
    const value = fixture();

    const imported = await value.service.importEvidence({
      userId: 7, conversationId: 'conversation-1', sourceTurnId: 'turn-1',
      targetTaskId: 'task-2', targetAgentRunId: 'run-2', evidenceIds: ['evidence-1'],
      authority: value.authority, now: '2026-08-16T00:02:00.000Z',
    });

    expect(imported).toEqual([expect.objectContaining({
      evidenceId: 'imported-id', taskId: 'task-2', provenanceKind: 'conversation_import',
      sourceTaskId: 'task-1', sourceEvidenceId: 'evidence-1', quote: '原文证据',
    })]);
    expect(value.readingTools.replayRange).toHaveBeenCalledWith(7, {
      bookId: 42, contentRevision: REVISION, sourceLocator: LOCATOR,
    });
  });

  it('returns the previously imported evidence id when a recovered step repeats the same source import', async () => {
    const value = fixture({ appendResult: 'existing' });

    const imported = await value.service.importEvidence({
      userId: 7, conversationId: 'conversation-1', sourceTurnId: 'turn-1',
      targetTaskId: 'task-2', targetAgentRunId: 'run-2', evidenceIds: ['evidence-1'],
      authority: value.authority, now: '2026-08-16T00:02:00.000Z',
    });

    expect(imported).toEqual([expect.objectContaining({
      evidenceId: 'existing-imported-id', sourceTaskId: 'task-1', sourceEvidenceId: 'evidence-1',
    })]);
  });

  it.each([
    ['wrong user', { userId: 8 }, 'CONVERSATION_NOT_FOUND'],
    ['wrong conversation', { sourceConversationId: 'conversation-2' }, 'EVIDENCE_IMPORT_SCOPE_MISMATCH'],
    ['active source', { sourceStatus: 'running' }, 'EVIDENCE_IMPORT_SOURCE_NOT_TERMINAL'],
    ['failed source outside direct retry', { sourceStatus: 'failed' }, 'EVIDENCE_IMPORT_SOURCE_NOT_STABLE'],
    ['legacy evidence', { sourceLocator: undefined }, 'EVIDENCE_IMPORT_SOURCE_LEGACY'],
    ['different revision', { sourceRevision: JSON.stringify({ ...REVISION, fileChecksum: 'sha256:v2' }) }, 'EVIDENCE_IMPORT_SCOPE_MISMATCH'],
  ] as const)('rejects %s', async (_name, overrides, reason) => {
    const value = fixture(overrides as never);
    await expect(value.service.importEvidence({
      userId: (overrides as { userId?: number }).userId ?? 7,
      conversationId: 'conversation-1', sourceTurnId: 'turn-1', targetTaskId: 'task-2',
      targetAgentRunId: 'run-2', evidenceIds: ['evidence-1'], authority: value.authority,
      now: '2026-08-16T00:02:00.000Z',
    })).rejects.toThrow(reason);
  });

  it.each(['failed', 'cancelled'] as const)(
    'allows a %s source only when the target is its direct retry turn',
    async (sourceStatus) => {
      const value = fixture({ sourceStatus, retryOfTurnId: 'turn-1' });

      const imported = await value.service.importEvidence({
        userId: 7, conversationId: 'conversation-1', sourceTurnId: 'turn-1',
        targetTaskId: 'task-2', targetAgentRunId: 'run-2', evidenceIds: ['evidence-1'],
        authority: value.authority, now: '2026-08-16T00:02:00.000Z',
      });

      expect(imported).toEqual([expect.objectContaining({
        sourceTaskId: 'task-1', sourceEvidenceId: 'evidence-1',
      })]);
    },
  );

  it.each([
    ['quote', { text: '篡改内容', sourceTextHash: createHash('sha256').update('篡改内容').digest('hex') }],
    ['hash', { text: '原文证据', sourceTextHash: 'f'.repeat(64) }],
  ] as const)('rejects replayed %s mismatch', async (_name, replayResult) => {
    const value = fixture({ replayResult });
    await expect(value.service.importEvidence({
      userId: 7, conversationId: 'conversation-1', sourceTurnId: 'turn-1', targetTaskId: 'task-2',
      targetAgentRunId: 'run-2', evidenceIds: ['evidence-1'], authority: value.authority,
      now: '2026-08-16T00:02:00.000Z',
    })).rejects.toThrow('EVIDENCE_IMPORT_REPLAY_MISMATCH');
  });
});

function fixture(overrides: {
  sourceConversationId?: string; sourceStatus?: string; sourceLocator?: unknown;
  sourceRevision?: string; replayResult?: { text: string; sourceTextHash: string };
  appendResult?: 'inserted' | 'existing';
  retryOfTurnId?: string;
} = {}) {
  const conversations = {
    findForUser: jest.fn((id: string, userId: number) => id === 'conversation-1' && userId === 7 ? {
      id, userId: '7', bookId: '42', contentRevision: SERIALIZED_REVISION,
    } : null),
    findTurnForUser: jest.fn((_conversationId: string, turnId: string) => {
      if (turnId === 'turn-1') return {
        id: 'turn-1', conversationId: overrides.sourceConversationId ?? 'conversation-1', taskId: 'task-1',
        status: overrides.sourceStatus ?? 'completed',
      };
      return null;
    }),
    findTurnByTaskId: jest.fn((taskId: string) => taskId === 'task-2' ? {
      id: 'turn-2', conversationId: 'conversation-1', taskId: 'task-2', status: 'running',
      retryOfTurnId: overrides.retryOfTurnId,
    } : null),
  };
  const sourceTextHash = createHash('sha256').update('原文证据').digest('hex');
  const evidence = {
    findForTask: jest.fn().mockReturnValue({
      evidenceId: 'evidence-1', taskId: 'task-1', agentRunId: 'run-1', quote: '原文证据',
      citation: { bookId: '42', contentRevision: overrides.sourceRevision ?? SERIALIZED_REVISION, locator: LOCATOR },
      sourceTextHash, sourceLocator: Object.prototype.hasOwnProperty.call(overrides, 'sourceLocator')
        ? overrides.sourceLocator : LOCATOR,
      provenanceKind: 'read', createdAt: '2026-08-16T00:01:00.000Z',
    }),
    append: jest.fn().mockReturnValue(overrides.appendResult ?? 'inserted'),
    findImportedForTask: jest.fn().mockReturnValue({
      evidenceId: 'existing-imported-id', taskId: 'task-2', agentRunId: 'run-2', quote: '原文证据',
      citation: { bookId: '42', contentRevision: SERIALIZED_REVISION, locator: LOCATOR },
      sourceTextHash, sourceLocator: LOCATOR, provenanceKind: 'conversation_import',
      sourceTaskId: 'task-1', sourceEvidenceId: 'evidence-1', createdAt: '2026-08-16T00:01:30.000Z',
    }),
  };
  const readingTools = {
    replayRange: jest.fn().mockResolvedValue({
      text: overrides.replayResult?.text ?? '原文证据',
      sourceTextHash: overrides.replayResult?.sourceTextHash ?? sourceTextHash,
      citation: { bookId: 42, contentRevision: REVISION, locator: LOCATOR },
    }),
  };
  const authority: AgentRunWriteAuthority = {
    lease: { agentRunId: 'run-2', workerId: 'worker', leaseToken: 'lease', generation: 1,
      expiresAt: '2026-08-16T00:03:00.000Z' },
    now: '2026-08-16T00:02:00.000Z',
  };
  return {
    authority, readingTools,
    service: new ConversationEvidenceImportService(
      conversations as never, evidence as never, readingTools as never, () => 'imported-id',
    ),
  };
}
