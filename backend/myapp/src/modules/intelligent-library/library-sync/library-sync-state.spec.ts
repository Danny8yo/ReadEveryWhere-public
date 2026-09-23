import { Logger } from "@nestjs/common";
import { LibrarySyncState } from "./library-sync-state";
describe("LibrarySyncState", () => {
  let sync: LibrarySyncState;
  beforeEach(() => {
    jest.useFakeTimers();
    sync = new LibrarySyncState();
  });
  afterEach(() => {
    sync.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  it("isolates users, preserves counters without subscribers and changes epoch on restart", () => {
    const other = jest.fn();
    sync.subscribe(2, other, () => {});
    sync.changed(1);
    expect(sync.version(1).revision).toBe(1);
    expect(sync.version(2).revision).toBe(0);
    expect(other).not.toHaveBeenCalled();
    expect(new LibrarySyncState().version(1).epoch).not.toBe(
      sync.version(1).epoch,
    );
  });
  it("advances immediately, isolates a broken subscriber and forces its recovery", () => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    const closed = jest.fn(),
      healthy = jest.fn();
    sync.subscribe(
      1,
      () => {
        throw Error("socket");
      },
      closed,
    );
    sync.subscribe(1, healthy, () => {});
    expect(() => sync.changed(1)).not.toThrow();
    expect(sync.version(1).revision).toBe(1);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
  });
  it("throttles latest progress but immediately advances watermarks and cancels terminal pending progress", () => {
    const events = jest.fn();
    sync.subscribe(1, events, () => {});
    sync.progress({ userId: 1, bookId: 2, taskId: 3, progress: 10 });
    sync.progress({ userId: 1, bookId: 2, taskId: 3, progress: 20 });
    sync.progress({ userId: 1, bookId: 2, taskId: 3, progress: 30 });
    expect(sync.watermark(1)).toBe(3);
    expect(sync.version(1).revision).toBe(0);
    expect(events).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(500);
    expect(events).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sequence: 3, progress: 30 }),
      }),
    );
    sync.progress({ userId: 1, bookId: 2, taskId: 3, progress: 40 });
    sync.changed(1, 3);
    jest.advanceTimersByTime(500);
    expect(events).toHaveBeenCalledTimes(3);
    expect(events).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "library_changed" }),
    );
  });
});
