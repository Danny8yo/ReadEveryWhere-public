import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  LibraryProjectionChangePort,
  LibraryVersion,
} from "../public/library-projection-change.port";
export type LibraryEvent =
  | { name: "library_changed"; data: { libraryVersion: LibraryVersion } }
  | {
      name: "download_progress";
      data: {
        epoch: string;
        sequence: number;
        bookId: number;
        taskId: number;
        progress: number;
      };
    };
interface Subscriber {
  send: (event: LibraryEvent) => void;
  close: () => void;
}
@Injectable()
export class LibrarySyncState
  implements LibraryProjectionChangePort, OnModuleDestroy
{
  private readonly logger = new Logger(LibrarySyncState.name);
  private readonly epoch = randomUUID();
  private readonly revisions = new Map<number, number>();
  private readonly sequences = new Map<number, number>();
  private readonly listeners = new Map<number, Set<Subscriber>>();
  private readonly pending = new Map<
    number,
    {
      timer: ReturnType<typeof setTimeout>;
      event: LibraryEvent;
      userId: number;
    }
  >();
  private readonly lastSent = new Map<number, number>();
  version(userId: number): LibraryVersion {
    return { epoch: this.epoch, revision: this.revisions.get(userId) ?? 0 };
  }
  watermark(userId: number): number {
    return this.sequences.get(userId) ?? 0;
  }
  subscribe(
    userId: number,
    send: Subscriber["send"],
    close: Subscriber["close"],
  ): () => void {
    let listeners = this.listeners.get(userId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(userId, listeners);
    }
    const entry = { send, close };
    listeners.add(entry);
    return () => {
      listeners.delete(entry);
      if (!listeners.size) this.listeners.delete(userId);
    };
  }
  changed(userId: number, taskId?: number): void {
    if (taskId !== undefined) this.clearProgress(taskId);
    this.revisions.set(userId, (this.revisions.get(userId) ?? 0) + 1);
    this.publish(userId, {
      name: "library_changed",
      data: { libraryVersion: this.version(userId) },
    });
  }
  progress(input: {
    userId: number;
    bookId: number;
    taskId: number;
    progress: number;
  }): void {
    const sequence = this.watermark(input.userId) + 1;
    this.sequences.set(input.userId, sequence);
    const event: LibraryEvent = {
      name: "download_progress",
      data: {
        epoch: this.epoch,
        sequence,
        bookId: input.bookId,
        taskId: input.taskId,
        progress: input.progress,
      },
    };
    const pending = this.pending.get(input.taskId);
    if (pending) {
      pending.event = event;
      return;
    }
    const delay = Math.max(
      0,
      500 - (Date.now() - (this.lastSent.get(input.taskId) ?? 0)),
    );
    if (!delay) {
      this.lastSent.set(input.taskId, Date.now());
      this.publish(input.userId, event);
      return;
    }
    const timer = setTimeout(() => {
      const latest = this.pending.get(input.taskId);
      if (!latest) return;
      this.pending.delete(input.taskId);
      this.lastSent.set(input.taskId, Date.now());
      this.publish(latest.userId, latest.event);
    }, delay);
    timer.unref();
    this.pending.set(input.taskId, { timer, event, userId: input.userId });
  }
  private clearProgress(taskId: number): void {
    const pending = this.pending.get(taskId);
    if (pending) clearTimeout(pending.timer);
    this.pending.delete(taskId);
    this.lastSent.delete(taskId);
  }
  private publish(userId: number, event: LibraryEvent): void {
    for (const listener of [...(this.listeners.get(userId) ?? [])]) {
      try {
        listener.send(event);
      } catch (error) {
        this.logger.error(
          error,
          "Committed library notification failed; closing subscriber for recovery",
        );
        try {
          listener.close();
        } catch (closeError) {
          this.logger.error(closeError);
        }
      }
    }
  }
  onModuleDestroy(): void {
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
    for (const listeners of this.listeners.values())
      for (const listener of listeners) listener.close();
    this.listeners.clear();
  }
}
