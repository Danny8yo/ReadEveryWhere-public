import { EventEmitter } from "node:events";
import { ReadingStateEventBus } from "../application/reading-state-event-bus";
import { ReadingStateController } from "./reading-state.controller";

// 编号对应 doc/同步测试用例审查.md
describe("笔记推送接口（ReadingStateController）", () => {
  it("C2 只推当前这本书的变化；本设备产生的变化不推回给自己；连接关闭后不再推", () => {
    const events = new ReadingStateEventBus();
    const snapshots = { execute: jest.fn().mockReturnValue({ revision: 0 }) };
    let cleanup = () => {};
    const sink = { send: jest.fn(), close: jest.fn() };
    const transport = { open: jest.fn((_req, _res, _auth, subscribe) => { cleanup = subscribe(sink); }) };
    const controller = new ReadingStateController(snapshots as never, events, transport as never, { isActive: () => true });
    const request = new EventEmitter() as EventEmitter & { user?: { userId: number; sessionId: string } };
    request.user = { userId: 3, sessionId: "session" };
    const response = new EventEmitter() as EventEmitter & {
      status: jest.Mock;
      setHeader: jest.Mock;
      flushHeaders: jest.Mock;
      write: jest.Mock;
    };
    response.status = jest.fn().mockReturnValue(response);
    response.setHeader = jest.fn();
    response.flushHeaders = jest.fn();
    response.write = jest.fn();

    controller.stream(request as never, response as never, { bookId: 7, deviceId: "device-a" });
    events.publish({ userId: 3, bookId: 8, revision: 1, changed: ["bookmarks"] });
    events.publish({ userId: 3, bookId: 7, revision: 2, changed: ["progress"], sourceDeviceId: "device-a" });
    events.publish({ userId: 3, bookId: 7, revision: 3, changed: ["annotations"] });

    expect(sink.send).toHaveBeenCalledWith("reading_state_changed", expect.objectContaining({ revision: 3 }));
    expect(sink.send).not.toHaveBeenCalledWith("reading_state_changed", expect.objectContaining({ revision: 1 }));
    expect(sink.send).not.toHaveBeenCalledWith("reading_state_changed", expect.objectContaining({ revision: 2 }));

    cleanup();
    sink.send.mockClear();
    events.publish({ userId: 3, bookId: 7, revision: 4, changed: ["bookmarks"] });
    expect(sink.send).not.toHaveBeenCalled();
  });
});
