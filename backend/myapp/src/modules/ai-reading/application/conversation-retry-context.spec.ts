import { buildConversationRetryContext } from './conversation-retry-context';

describe('buildConversationRetryContext', () => {
  it('returns bounded replayable candidates and a sanitized stable failure code', () => {
    const context = buildConversationRetryContext({
      sourceTurnId: 'turn-1', sourceStatus: 'failed', terminalReason: 'model connection failed: secret body',
      bookId: '42', contentRevision: 'revision-1',
      evidence: [
        {
          evidenceId: 'evidence-1', taskId: 'task-1', agentRunId: 'run-1', quote: '证'.repeat(300),
          citation: { bookId: '42', contentRevision: 'revision-1', chapterPath: '第一章', locator: { version: 1 } },
          sourceTextHash: 'a'.repeat(64), sourceLocator: { version: 1 }, createdAt: '2026-08-16T00:00:00.000Z',
        },
        {
          evidenceId: 'legacy', taskId: 'task-1', agentRunId: 'run-1', quote: '旧证据',
          citation: { bookId: '42', contentRevision: 'revision-1', locator: { version: 1 } }, sourceTextHash: 'b'.repeat(64),
          createdAt: '2026-08-16T00:00:00.000Z',
        },
      ],
    });

    expect(context).toEqual({
      sourceTurnId: 'turn-1', sourceStatus: 'failed', failureCode: 'TURN_FAILED',
      evidenceCandidates: [{
        sourceEvidenceId: 'evidence-1', chapterPath: '第一章', quotePreview: `${'证'.repeat(239)}…`,
      }],
    });
    expect(JSON.stringify(context)).not.toContain('secret body');
    expect(JSON.stringify(context)).not.toContain('sourceTextHash');
    expect(JSON.stringify(context)).not.toContain('sourceLocator');
  });
});
