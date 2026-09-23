import { EventEmitter } from 'node:events';
import { SelectionQaController } from './selection-qa.controller';
import type { SelectionQaService } from '../application/selection-qa.service';
import type { SelectionQaEvent } from '../application/selection-qa.types';

describe('selection QA live SSE delivery', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  function fixture() {
    let notify = () => {};
    let status = 'running';
    const events: SelectionQaEvent[] = [];
    const unsubscribe = jest.fn();
    const service = {
      events: jest.fn((_user, _id, after: number) => events.filter(e => e.sequence > after).slice(0, 200)),
      getTurn: () => ({ status }),
      subscribe: (_user: number, _id: string, callback: () => void) => { notify = callback; return unsubscribe; },
    };
    const res = Object.assign(new EventEmitter(), { setHeader: jest.fn(), flushHeaders: jest.fn(), write: jest.fn(() => true), end: jest.fn() });
    const req = Object.assign(new EventEmitter(), { user: { userId: 1 } });
    const controller = new SelectionQaController(service as unknown as SelectionQaService);
    return { res, req, events, unsubscribe, controller, notify: () => notify(), finish: () => { status = 'completed'; } };
  }
  function delta(sequence: number): SelectionQaEvent { return { schemaVersion: 1, turnId: 'turn', sequence, kind: 'answer_delta', data: { text: 'part' } }; }
  it('pushes committed deltas before terminal, obeys backpressure, and cleans up on disconnect', async () => {
    const f = fixture();
    await f.controller.events(f.req as any, 'turn', { afterSequence: 0 }, f.res as any);
    f.events.push(delta(1)); f.notify();
    jest.advanceTimersByTime(40);
    expect(f.res.write).toHaveBeenCalledTimes(1);
    expect(f.res.end).not.toHaveBeenCalled();
    f.res.write.mockReturnValueOnce(false);
    f.events.push(delta(2)); f.notify(); jest.advanceTimersByTime(40);
    f.events.push(delta(3)); f.notify(); jest.advanceTimersByTime(100);
    expect(f.res.write).toHaveBeenCalledTimes(2);
    f.res.emit('drain');
    expect(f.res.write).toHaveBeenCalledTimes(3);
    expect(f.res.write.mock.calls.map(c => JSON.parse((c as any)[0].split('data: ')[1]).sequence)).toEqual([1, 2, 3]);
    f.res.emit('close');
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    f.events.push(delta(4)); f.notify(); jest.advanceTimersByTime(20000);
    expect(f.res.write).toHaveBeenCalledTimes(3);
  });
  it('drains more than one replay page before closing terminal streams', async () => {
    const f = fixture();
    f.events.push(...Array.from({ length: 205 }, (_, i) => delta(i + 1)));
    f.finish();
    await f.controller.events(f.req as any, 'turn', { afterSequence: 0 }, f.res as any);
    expect(f.res.write).toHaveBeenCalledTimes(200);
    expect(f.res.end).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(f.res.write).toHaveBeenCalledTimes(205);
    expect(f.res.end).toHaveBeenCalledTimes(1);
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
