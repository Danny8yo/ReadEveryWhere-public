import { ReadingStateEventBus } from "./reading-state-event-bus";

// 编号对应 doc/同步测试用例审查.md
describe("笔记变化分发（ReadingStateEventBus）", () => {
  it("C1 笔记变化只通知同用户、同一本书的订阅者；取消订阅后不再收到", () => {
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
