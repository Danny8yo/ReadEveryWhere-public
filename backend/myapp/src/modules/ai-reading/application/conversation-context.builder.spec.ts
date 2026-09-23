import { ConversationCheckpoint } from '../domain';
import { ConversationContextBuilder } from './conversation-context.builder';

describe('ConversationContextBuilder', () => {
  it('builds a bounded provenance context without historical transcripts or trusted scope fields', () => {
    const checkpoint = ConversationCheckpoint.create({
      id: 'checkpoint-1', conversationId: 'conversation-1', throughTurnId: 'turn-1',
      memory: {
        turnSummaries: [{ turnId: 'turn-1', summary: '上一轮解释了核心判断。' }],
        findings: [{ text: '核心判断有两个依据。', sourceTurnId: 'turn-1', evidenceIds: ['old-evidence'] }],
        preferences: [], topics: [], openQuestions: [], planSteps: [], chapterRanges: [],
        sourceEvidenceRefs: [{ sourceTurnId: 'turn-1', sourceTaskId: 'task-1', sourceEvidenceId: 'old-evidence' }],
      }, now: '2026-08-16T00:00:00.000Z',
    });

    const context = new ConversationContextBuilder().build({
      rootGoal: '理解核心论点', currentMessage: '解释上一条', checkpoint,
      profileSnapshot: {
        profileId: 'profile-1', primaryGenre: 'nonfiction', secondaryGenres: [], traits: [], confidence: 0.9,
        classificationSummary: 'Argumentative nonfiction.',
        contentRevision: { fileChecksum: 'rev', extractorVersion: 'epub-v1', normalizationVersion: 'text-v1' },
        modelId: 'deepseek-v4-flash', strategyVersion: 'v1', analyzedAt: '2026-08-16T00:00:00.000Z',
        spoilerPolicy: 'avoid_unless_user_requests',
      },
      readerFocus: null,
      retrySource: {
        sourceTurnId: 'turn-failed', sourceStatus: 'failed', failureCode: 'MODEL_CONNECTION_FAILED',
        evidenceCandidates: [{
          sourceEvidenceId: 'failed-evidence', chapterPath: '第二章', quotePreview: '失败前核验的短证据',
        }],
      },
    });

    expect(context).toMatchObject({
      schemaVersion: 2, rootGoal: '理解核心论点', currentMessage: '解释上一条',
      retrySource: {
        sourceTurnId: 'turn-failed', failureCode: 'MODEL_CONNECTION_FAILED',
        evidenceCandidates: [{ sourceEvidenceId: 'failed-evidence' }],
      },
    });
    expect(JSON.stringify(context)).not.toContain('assistantMessages');
    expect(JSON.stringify(context)).not.toContain('userId');
    expect(JSON.stringify(context)).not.toContain('bookId');
    expect(JSON.stringify(context)).not.toContain('contentRevision');
  });
});
