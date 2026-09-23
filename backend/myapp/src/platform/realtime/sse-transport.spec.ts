import { createServer, type Server, type ServerResponse } from "node:http";
import { Logger } from "@nestjs/common";
import { SseTransport, type SseSink } from "./sse-transport";
describe("SseTransport with real better-sse framing", () => {
  let server: Server, url: string, sink: SseSink, response: ServerResponse;
  let active: boolean, failure: boolean;
  let cleanup: jest.Mock;
  beforeEach(async () => {
    active = true;
    failure = false;
    cleanup = jest.fn();
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    server = createServer((req, res) => {
      response = res;
      new SseTransport().open(
        req as never,
        res as never,
        () => {
          if (failure) throw Error("database unavailable");
          return active;
        },
        (value) => {
          sink = value;
          return cleanup;
        },
        () => ({ revision: 1 }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    jest.restoreAllMocks();
  });
  async function open() {
    const abort = new AbortController();
    const result = await fetch(url, { signal: abort.signal });
    const reader = result.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("event:ready");
    return { reader, abort, result };
  }
  it("sends library frames and cleans its subscription when the client disconnects", async () => {
    const { reader, abort, result } = await open();
    expect(result.headers.get("x-accel-buffering")).toBe("no");
    sink.send("library_changed", {
      libraryVersion: { epoch: "test", revision: 2 },
    });
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      '"revision":2',
    );
    abort.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("clears the library keepAlive timer when authorization fails during initialization", async () => {
    const intervals = jest.spyOn(globalThis, "setInterval");
    const cleared = jest.spyOn(globalThis, "clearInterval");
    active = false;
    await expect(fetch(url)).rejects.toThrow();
    expect(intervals).toHaveBeenCalled();
    expect(cleared).toHaveBeenCalledWith(intervals.mock.results[0].value);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it.each(["expired", "database", "backpressure"])(
    "closes on %s before sending business data",
    async (reason) => {
      const { reader } = await open();
      if (reason === "expired") active = false;
      if (reason === "database") failure = true;
      if (reason === "backpressure")
        Object.defineProperty(response, "writableNeedDrain", { value: true });
      sink.send("library_changed", { secret: "must not arrive" });
      await expect(reader.read()).rejects.toThrow();
      expect(cleanup).toHaveBeenCalledTimes(1);
    },
  );
});
