import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import { get, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { StreamBookFileHttpService } from "./stream-book-file-http.service";

const mockCreatedStreams: fs.ReadStream[] = [];
jest.mock("node:fs", () => {
  const actual = jest.requireActual<typeof fs>("node:fs");
  return {
    ...actual,
    createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
      const stream = actual.createReadStream(...args);
      mockCreatedStreams.push(stream);
      return stream;
    },
  };
});

async function serveFile(absolutePath: string, mimeType: string) {
  const service = new StreamBookFileHttpService({
    findForStreaming: () => ({ absolutePath, downloadStatus: "completed", mimeType }) as never,
  });
  const app = express();
  app.get("/file", (req, res) => void service.execute(1, 1, req, res));
  const server: Server = await new Promise((resolve) => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/file` };
}

describe("StreamBookFileHttpService", () => {
  it("handles a read-stream error after the file was stat'ed", async () => {
    const file = new EventEmitter() as fs.ReadStream;
    file.pipe = (() => file) as fs.ReadStream["pipe"];

    const response = Object.assign(new EventEmitter(), {
      headersSent: true,
      destroy: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    }) as any;

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
    const response = Object.assign(new EventEmitter(), {
      headersSent: false,
      destroy: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    }) as any;
    const service = new StreamBookFileHttpService({ findForStreaming: () => null });

    (service as any).pipeWithErrorHandling(file, response);
    file.emit("error", Object.assign(new Error("permission denied"), { code: "EACCES" }));

    expect(response.destroy).toHaveBeenCalledWith(expect.objectContaining({ code: "EACCES" }));
    expect(response.status).not.toHaveBeenCalled();
  });

  it("closes the file when the client aborts mid-stream", async () => {
    const path = join(fs.mkdtempSync(join(tmpdir(), "rew-stream-")), "book.epub");
    fs.writeFileSync(path, Buffer.alloc(32 * 1024 * 1024));
    mockCreatedStreams.length = 0;
    const streams = mockCreatedStreams;
    const { server, url } = await serveFile(path, "application/epub+zip");
    try {
      await new Promise<void>((resolve) => {
        const request = get(url, (response) => response.once("data", () => {
          request.destroy();
          resolve();
        }));
      });
      for (let waited = 0; !streams[0]?.destroyed && waited < 2_000; waited += 20) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(streams).toHaveLength(1);
      expect(streams[0].destroyed).toBe(true);
    } finally {
      server.close();
      fs.rmSync(path, { force: true });
    }
  });

  it("never serves a stored non-ebook MIME and sandboxes direct navigation", async () => {
    const path = join(fs.mkdtempSync(join(tmpdir(), "rew-stream-")), "book.epub");
    fs.writeFileSync(path, "<script>alert(1)</script>");
    const { server, url } = await serveFile(path, "text/html");
    try {
      const headers = await new Promise<Record<string, unknown>>((resolve) => {
        get(url, (response) => {
          response.resume();
          resolve(response.headers);
        });
      });
      expect(headers["content-type"]).toBe("application/octet-stream");
      expect(headers["content-security-policy"]).toBe("sandbox; default-src 'none'");
      expect(headers["x-content-type-options"]).toBe("nosniff");
    } finally {
      server.close();
      fs.rmSync(path, { force: true });
    }
  });
});
