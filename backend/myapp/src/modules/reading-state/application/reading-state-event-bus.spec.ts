import { ReadingStateEventBus } from "./reading-state-event-bus";

describe("ReadingStateEventBus", () => {
  it("delivers changes only to matching user and book subscribers", () => {
    const bus = new ReadingStateEventBus();
    const matching = jest.fn();
    const otherBook = jest.fn();
    const otherUser = jest.fn();

    const stopMatching = bus.subscribe({ userId: 1, bookId: 7 }, matching);
    bus.subscribe({ userId: 1, bookId: 8 }, otherBook);
    bus.subscribe({ userId: 2, bookId: 7 }, otherUser);

    bus.publish({ userId: 1, bookId: 7, revision: 3, changed: ["annotations"] });

    expect(matching).toHaveBeenCalledWith(expect.objectContaining({ revision: 3 }));
    expect(otherBook).not.toHaveBeenCalled();
    expect(otherUser).not.toHaveBeenCalled();

    stopMatching();
    bus.publish({ userId: 1, bookId: 7, revision: 4, changed: ["bookmarks"] });
    expect(matching).toHaveBeenCalledTimes(1);
  });
});
