import { ConversationTurn } from './conversation-turn';

const NOW = '2026-08-16T00:00:00.000Z';

describe('ConversationTurn', () => {
  it('links exactly one immutable task and follows the task terminal states', () => {
    const turn = makeTurn();
    turn.start('2026-08-16T00:00:01.000Z');
    turn.complete('completed', '2026-08-16T00:00:02.000Z');

    expect(turn.toJSON()).toMatchObject({ status: 'completed', taskId: 'task-1', finishedAt: '2026-08-16T00:00:02.000Z' });
    expect(() => turn.start('2026-08-16T00:00:03.000Z')).toThrow('TURN_TRANSITION_INVALID');
    expect(() => turn.complete('failed', '2026-08-16T00:00:03.000Z')).toThrow('TURN_TRANSITION_INVALID');
  });

  it('records a clarification without reopening the turn', () => {
    const turn = makeTurn();
    turn.start('2026-08-16T00:00:01.000Z');
    turn.requestInput('你说的“这一章”是第三章还是第四章？', '2026-08-16T00:00:02.000Z');

    expect(turn.toJSON()).toMatchObject({
      status: 'needs_input',
      clarificationQuestion: '你说的“这一章”是第三章还是第四章？',
    });
    expect(turn.isActive).toBe(false);
  });

  it('allows retry only from failed or cancelled and requires a new task', () => {
    const failed = makeTurn();
    failed.complete('failed', '2026-08-16T00:00:01.000Z');

    const retry = ConversationTurn.createRetry({
      source: failed,
      id: 'turn-2',
      taskId: 'task-2',
      turnNumber: 2,
      now: '2026-08-16T00:00:02.000Z',
    });
    expect(retry.toJSON()).toMatchObject({ retryOfTurnId: 'turn-1', taskId: 'task-2', userInput: '解释上一条' });
    expect(() => ConversationTurn.createRetry({
      source: failed, id: 'turn-3', taskId: 'task-1', turnNumber: 3, now: '2026-08-16T00:00:03.000Z',
    })).toThrow('TURN_RETRY_TASK_REUSED');

    const completed = makeTurn();
    completed.start('2026-08-16T00:00:00.500Z');
    completed.complete('completed', '2026-08-16T00:00:01.000Z');
    expect(() => ConversationTurn.createRetry({
      source: completed, id: 'turn-3', taskId: 'task-3', turnNumber: 3, now: '2026-08-16T00:00:03.000Z',
    })).toThrow('TURN_NOT_RETRYABLE');
  });
});

function makeTurn() {
  return ConversationTurn.create({
    id: 'turn-1', conversationId: 'conversation-1', taskId: 'task-1', turnNumber: 1,
    userInput: '解释上一条', readerFocus: { sectionIndex: 3, chapterLabel: '第三章' }, now: NOW,
  });
}
