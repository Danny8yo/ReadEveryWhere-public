import { ReadingEvent } from './reading-event';

describe('ReadingEvent', () => {
  it('creates a serializable, task-attributed event for concurrent agents', () => {
    const event = ReadingEvent.create({
      sequence: 7,
      type: 'tool_observation',
      occurredAt: '2026-08-06T00:00:00.000Z',
      taskId: 'task-1',
      agentRunId: 'child-2',
      parentRunId: 'root-1',
      stepId: 'step-3',
      toolCallId: 'tool-call-4',
      payload: { toolName: 'book_read', observation: 'Found a relevant passage' },
    });

    expect(ReadingEvent.fromJSON(event.toJSON()).toJSON()).toEqual({
      sequence: 7,
      type: 'tool_observation',
      occurredAt: '2026-08-06T00:00:00.000Z',
      taskId: 'task-1',
      agentRunId: 'child-2',
      parentRunId: 'root-1',
      stepId: 'step-3',
      toolCallId: 'tool-call-4',
      payload: { toolName: 'book_read', observation: 'Found a relevant passage' },
    });
  });

  it('requires a positive integer sequence and a task id', () => {
    expect(() =>
      ReadingEvent.create({
        sequence: 0,
        type: 'task_started',
        occurredAt: '2026-08-06T00:00:00.000Z',
        taskId: 'task-1',
        payload: {},
      }),
    ).toThrow('READING_EVENT_INVALID');
    expect(() =>
      ReadingEvent.create({
        sequence: 1,
        type: 'task_started',
        occurredAt: '2026-08-06T00:00:00.000Z',
        taskId: '',
        payload: {},
      }),
    ).toThrow('READING_EVENT_INVALID');
  });
});
