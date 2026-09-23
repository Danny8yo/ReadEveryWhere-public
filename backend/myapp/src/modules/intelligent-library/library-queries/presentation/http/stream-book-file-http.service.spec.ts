import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import { StreamBookFileHttpService } from "./stream-book-file-http.service";

describe("StreamBookFileHttpService", () => {
  it("handles a read-stream error after the file was stat'ed", async () => {
    const file = new EventEmitter() as fs.ReadStream;
    file.pipe = (() => file) as fs.ReadStream["pipe"];

    const response = {
      headersSent: true,
      destroy: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    } as any;

    const service = new StreamBookFileHttpService({
      findForStreaming: () => null,
    });
    (service as any).pipeWithErrorHandling(file, response);
    file.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" }));
    expect(response.destroy).toHaveBeenCalled();
  });

  it("does not translate non-ENOENT stream errors into a not-found response", () => {
    const file = new EventEmitter() as fs.ReadStream;
    file.pipe = (() => file) as fs.ReadStream["pipe"];
    const response = {
      headersSent: false,
      destroy: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as any;
    const service = new StreamBookFileHttpService({ findForStreaming: () => null });

    (service as any).pipeWithErrorHandling(file, response);
    file.emit("error", Object.assign(new Error("permission denied"), { code: "EACCES" }));

    expect(response.destroy).toHaveBeenCalledWith(expect.objectContaining({ code: "EACCES" }));
    expect(response.status).not.toHaveBeenCalled();
  });
});
