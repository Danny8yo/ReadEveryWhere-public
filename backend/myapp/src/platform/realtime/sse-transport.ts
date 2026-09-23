import { Injectable, Logger, Module, OnModuleDestroy } from "@nestjs/common";
import { NodeHttp1Connection, Session } from "better-sse";
import type { Request, Response } from "express";

export interface SseSink {
  send(name: string, data: unknown): void;
  close(): void;
}
/** better-sse owns framing/lifecycle; this adapter bounds Node's buffer and authorizes every write. */
@Injectable()
export class SseTransport implements OnModuleDestroy {
  private readonly connections = new Set<() => void>();
  onModuleDestroy(): void {
    for (const close of [...this.connections]) close();
  }
  private readonly logger = new Logger(SseTransport.name);
  open(
    req: Request,
    res: Response,
    authorized: () => boolean,
    subscribe: (sink: SseSink) => () => void,
    ready: () => unknown,
  ): void {
    let cleanupSubscription = () => {};
    let closed = false;
    let session: Session | undefined;
    const lifecycle = new AbortController();
    const close = () => {
      if (closed) return;
      closed = true;
      this.connections.delete(close);
      try {
        cleanupSubscription();
      } catch (error) {
        this.logger.error(error, "SSE subscription cleanup failed");
      } finally {
        if (session?.isConnected) lifecycle.abort();
        res.destroy();
      }
    };
    this.connections.add(close);
    const connection = new NodeHttp1Connection(req, res, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
    // The library initializes on setImmediate. Defer its abort until connected so an
    // early socket close cannot leave a keepAlive timer created after disconnection.
    connection.request = new globalThis.Request(connection.request, {
      signal: lifecycle.signal,
    });
    const originalCleanup = connection.cleanup;
    connection.cleanup = () => {
      res.removeListener("close", close);
      originalCleanup();
    };
    res.once("close", close);
    const originalSend = connection.sendChunk;
    connection.sendChunk = (chunk: string) => {
      if (closed) return;
      try {
        if (!authorized()) {
          close();
          return;
        }
        // No application queue: while the writable is congested, terminate and recover from a snapshot.
        // This caps memory to the existing bounded buffer plus one small business event.
        if (
          res.writableNeedDrain ||
          res.writableLength + Buffer.byteLength(chunk) > 64 * 1024
        ) {
          this.logger.warn("Closing slow SSE consumer");
          close();
          return;
        }
        originalSend(chunk);
      } catch (error) {
        this.logger.error(error, "SSE authorization/write failed");
        close();
      }
    };
    session = new Session(connection, {
      keepAlive: 15_000,
      retry: null,
      trustClientEventId: false,
    });
    const sink: SseSink = {
      close,
      send: (name, data) => {
        if (!closed && session?.isConnected) session.push(data, name);
      },
    };
    session.once("disconnected", close);
    session.once("connected", () => {
      if (closed) {
        lifecycle.abort();
        return;
      }
      // Subscription precedes ready. Both operations are synchronous; ready contains current business state.
      try {
        cleanupSubscription = subscribe(sink);
        sink.send("ready", ready());
      } catch (error) {
        this.logger.error(error, "SSE subscription initialization failed");
        close();
      }
    });
  }
}
@Module({ providers: [SseTransport], exports: [SseTransport] })
export class RealtimeModule {}
