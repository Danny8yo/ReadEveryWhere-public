import type { ReadingStateChangeKind } from "./ports/reading-state-change.port";

export interface ReadingStateChangedEvent {
  userId: number;
  bookId: number;
  revision: number;
  changed: readonly ReadingStateChangeKind[];
  sourceDeviceId?: string | null;
}

type Listener = (event: ReadingStateChangedEvent) => void;

export class ReadingStateEventBus {
  private readonly subscriptions = new Set<{
    userId: number;
    bookId: number;
    listener: Listener;
  }>();

  subscribe(
    scope: Readonly<{ userId: number; bookId: number }>,
    listener: Listener,
  ): () => void {
    const subscription = { ...scope, listener };
    this.subscriptions.add(subscription);
    return () => this.subscriptions.delete(subscription);
  }

  publish(event: ReadingStateChangedEvent): void {
    for (const subscription of this.subscriptions) {
      if (subscription.userId === event.userId && subscription.bookId === event.bookId) {
        subscription.listener(event);
      }
    }
  }
}
