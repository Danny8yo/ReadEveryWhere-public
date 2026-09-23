import { getEventListeners } from 'node:events';
import { DeepSeekLanguageModelAdapter } from './deepseek-language-model.adapter';
import type { ModelCompletionRequest } from '../../support/ai-model/public';

const request: ModelCompletionRequest = { providerId: 'deepseek', modelId: 'deepseek-test', apiKey: 'test-only', messages: [{ role: 'user', content: 'test' }] };
const success = () => new Response(JSON.stringify({ id: 'ok', choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }));
const delta = 'data: {"choices":[{"delta":{"content":"字"}}]}\n\n';
const cancelled = { code: 'MODEL_CANCELLED', kind: 'cancelled', retryable: false };

describe('DeepSeek cancellation and bounded HTTP attempts', () => {
  it.each(['complete', 'stream'] as const)('rejects already aborted %s before fetch', async mode => {
    const fetchFn = jest.fn(); const adapter = new DeepSeekLanguageModelAdapter(fetchFn);
    const controller = new AbortController(); controller.abort(new Error('user stop'));
    const input = { ...request, signal: controller.signal };
    await expect(mode === 'complete' ? adapter.complete(input) : adapter.streamText(input, () => {})).rejects.toMatchObject(cancelled);
    expect(fetchFn).not.toHaveBeenCalled(); expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });
  it.each(['complete', 'stream'] as const)('cancels %s during fetch without retry or leaked listeners', async mode => {
    const controller = new AbortController(); let upstream!: AbortSignal;
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    const fetchFn = jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      upstream = init!.signal!; upstream.addEventListener('abort', () => reject(upstream.reason), { once: true }); started();
    }));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn);
    const input = { ...request, signal: controller.signal };
    const pending = mode === 'complete' ? adapter.complete(input) : adapter.streamText(input, () => {});
    const checked = expect(pending).rejects.toMatchObject(cancelled);
    await ready; controller.abort(new Error('stopped')); await checked;
    expect(upstream.aborted).toBe(true); expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });
  it('cancels a pending SSE reader, releases its lock and publishes no later deltas', async () => {
    const controller = new AbortController(); const cancel = jest.fn(); let received!: () => void;
    const first = new Promise<void>(resolve => { received = resolve; });
    const body = new ReadableStream<Uint8Array>({ start(s) { s.enqueue(new TextEncoder().encode(delta)); }, cancel });
    const fetchFn = jest.fn(async () => new Response(body)); const adapter = new DeepSeekLanguageModelAdapter(fetchFn);
    const deltas: string[] = [];
    const pending = adapter.streamText({ ...request, signal: controller.signal }, text => { deltas.push(text); received(); });
    const checked = expect(pending).rejects.toMatchObject(cancelled);
    await first; controller.abort(new Error('stop stream')); await checked;
    expect(deltas).toEqual(['字']); expect(cancel).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1); expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });
  it('preserves onDelta lease failure and immediately aborts the upstream without retry', async () => {
    let upstream!: AbortSignal; const cancel = jest.fn();
    const body = new ReadableStream<Uint8Array>({ start(s) { s.enqueue(new TextEncoder().encode(delta)); }, cancel });
    const fetchFn = jest.fn(async (_url: string, init?: RequestInit) => { upstream = init!.signal!; return new Response(body); });
    const failure = new Error('LEASE_LOST');
    await expect(new DeepSeekLanguageModelAdapter(fetchFn).streamText(request, () => { throw failure; })).rejects.toBe(failure);
    expect(fetchFn).toHaveBeenCalledTimes(1); expect(upstream.aborted).toBe(true); expect(cancel).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false);
  });
  it.each(['complete', 'stream'] as const)('cancels %s during Retry-After backoff', async mode => {
    const controller = new AbortController(); let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    const sleep = jest.fn(() => { entered(); return new Promise<void>(() => {}); });
    const fetchFn = jest.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '10' } }));
    const adapter = new DeepSeekLanguageModelAdapter(fetchFn, sleep); const input = { ...request, signal: controller.signal };
    const pending = mode === 'complete' ? adapter.complete(input) : adapter.streamText(input, () => {});
    const checked = expect(pending).rejects.toMatchObject(cancelled);
    await ready; controller.abort(); await checked;
    expect(sleep).toHaveBeenCalledWith(10000); expect(fetchFn).toHaveBeenCalledTimes(1); expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });
  it.each(['network', '429', '503', 'invalid'] as const)('maxAttempts=1 forbids complete retries after %s', async failure => {
    const fetchFn = jest.fn(async () => {
      if (failure === 'network') throw new TypeError('network down');
      return failure === 'invalid' ? new Response('{') : new Response('', { status: Number(failure) });
    });
    const sleep = jest.fn(async () => {});
    await expect(new DeepSeekLanguageModelAdapter(fetchFn, sleep).complete({ ...request, maxAttempts: 1 })).rejects.toMatchObject({ attempt: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(1); expect(sleep).not.toHaveBeenCalled();
  });
  it.each(['network', '429', '503', 'invalid'] as const)('maxAttempts=1 forbids stream retries after %s', async failure => {
    const fetchFn = jest.fn(async () => {
      if (failure === 'network') throw new TypeError('network down');
      return failure === 'invalid' ? new Response('data: broken\n') : new Response('', { status: Number(failure) });
    });
    const sleep = jest.fn(async () => {});
    await expect(new DeepSeekLanguageModelAdapter(fetchFn, sleep).streamText({ ...request, maxAttempts: 1 }, () => {})).rejects.toMatchObject({ attempt: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(1); expect(sleep).not.toHaveBeenCalled();
  });
  it('removes listeners after successful completion and validates attempts before HTTP', async () => {
    const controller = new AbortController(); const fetchFn = jest.fn(async () => success()); const adapter = new DeepSeekLanguageModelAdapter(fetchFn);
    await adapter.complete({ ...request, signal: controller.signal }); expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    for (const maxAttempts of [0, 4, 1.5, NaN]) await expect(adapter.complete({ ...request, maxAttempts })).rejects.toMatchObject({ code: 'MODEL_MESSAGE_INVALID' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('clears default backoff and attempt timers after cancellation', async () => {
    jest.useFakeTimers();
    try {
      const controller=new AbortController();
      const fetchFn=jest.fn(async()=>new Response('',{status:503}));
      const adapter=new DeepSeekLanguageModelAdapter(fetchFn);
      const pending=adapter.complete({...request,signal:controller.signal});
      const checked=expect(pending).rejects.toMatchObject(cancelled);
      await jest.advanceTimersByTimeAsync(1);
      expect(jest.getTimerCount()).toBe(1);
      controller.abort();await checked;
      expect(jest.getTimerCount()).toBe(0);expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });
  it('keeps internal deadline expiry distinct from external cancellation and clears timers', async () => {
    jest.useFakeTimers();
    try {
      const fetchFn=jest.fn((_url:string,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
        init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true});
      }));
      const pending=new DeepSeekLanguageModelAdapter(fetchFn).complete({...request,timeoutMs:10,maxAttempts:1});
      const checked=expect(pending).rejects.toMatchObject({kind:'timeout',code:'DEEPSEEK_TIMEOUT'});
      await jest.advanceTimersByTimeAsync(10);await checked;
      expect(jest.getTimerCount()).toBe(0);expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });

  it('does not publish buffered SSE deltas after the first callback cancels', async () => {
    const controller=new AbortController();const deltas:string[]=[];
    const fetchFn=jest.fn(async()=>new Response(delta+delta+delta));
    await expect(new DeepSeekLanguageModelAdapter(fetchFn).streamText({...request,signal:controller.signal},text=>{
      deltas.push(text);controller.abort();
    })).rejects.toMatchObject(cancelled);
    expect(deltas).toEqual(['字']);expect(fetchFn).toHaveBeenCalledTimes(1);
  });

});
