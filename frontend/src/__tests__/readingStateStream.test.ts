import { describe, it, expect, vi } from "vitest";
import { openReadingStateStream } from "../features/reader/api/readingStateApi";
const transport = vi.hoisted(() => ({ open: vi.fn(() => () => {}) }));
vi.mock("../services/sseTransport", () => ({ openCookieSse: transport.open }));
describe("reading state stream readiness", () => {
  it("waits for subscribed ready before recovery and does not block subsequent messages on snapshots", async () => {
    const onOpen = vi.fn(() => new Promise<void>(() => {})),
      onChange = vi.fn(),
      onError = vi.fn();
    openReadingStateStream(7, { onOpen, onChange, onError }, "device");
    const handlers = (transport.open.mock.calls as any)[0][1];
    expect(handlers.open).toBeUndefined();
    handlers.message({ event: "ready", data: "{}" });
    handlers.message({
      event: "reading_state_changed",
      data: JSON.stringify({
        bookId: 7,
        revision: 2,
        changed: ["annotations"],
      }),
    });
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });
});
