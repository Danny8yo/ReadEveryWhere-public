// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { openCookieSse } from "../services/sseTransport";
const auth = vi.hoisted(() => ({ fetch: vi.fn(), version: "a" }));
vi.mock("../services/apiClient", () => ({
  fetchWithAuth: auth.fetch,
  getBaseUrl: () => "/backend",
  getSessionVersion: () => auth.version,
  resolveBackendUrl: (p: string) => "http://localhost" + p,
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  auth.version = "a";
});
describe("cookie SSE transport", () => {
  it("stops permanently on 401 without letting the library reconnect", async () => {
    vi.useFakeTimers();
    auth.fetch.mockResolvedValue(new Response("", { status: 401 }));
    const stop = openCookieSse("/stream", { message: vi.fn(), error: vi.fn() });
    await vi.advanceTimersByTimeAsync(100000);
    expect(auth.fetch).toHaveBeenCalledTimes(1);
    stop();
  });
  it("uses library comment parsing as liveness and aborts on disposal", async () => {
    vi.useFakeTimers();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    auth.fetch.mockImplementation((_url, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              stream = controller;
              init.signal.addEventListener("abort", () => controller.close());
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
      ),
    );
    const events = vi.fn();
    const stop = openCookieSse("/stream", { message: events, error: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 5; i++) {
      stream.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
      await vi.advanceTimersByTimeAsync(15000);
    }
    expect(auth.fetch).toHaveBeenCalledTimes(1);
    stream.enqueue(new TextEncoder().encode("event: ready\ndata: {}\n\n"));
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toHaveBeenCalledOnce();
    stop();
    await vi.advanceTimersByTimeAsync(100000);
    expect(auth.fetch).toHaveBeenCalledTimes(1);
  });
});
it("detects a silent foreground connection at 45 seconds and releases all timers", async () => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  auth.fetch.mockImplementation((_url, init) =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            init.signal.addEventListener("abort", () => controller.close());
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    ),
  );
  const stop = openCookieSse("/stream", { message: vi.fn(), error: vi.fn() });
  await vi.advanceTimersByTimeAsync(44000);
  expect(auth.fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(auth.fetch).toHaveBeenCalledTimes(2);
  stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
});
