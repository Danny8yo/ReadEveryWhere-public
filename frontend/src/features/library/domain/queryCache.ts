import type { LibraryVersion, DownloadProgressEvent } from "../model/sync";
import type { LoadLibraryParams } from "./library";
import type { LibraryListResponse, LibraryBook } from "../model/library";
export interface LibraryInvalidationPort {
  invalidate(): void;
}
export interface CacheClock {
  now(): number;
  schedule(callback: () => void, ms: number): () => void;
}
export function normalizeLibraryQuery(
  input: LoadLibraryParams,
): LoadLibraryParams {
  return {
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 20,
    ...(input.keyword?.trim() ? { keyword: input.keyword.trim() } : {}),
    ...(input.primaryGenre ? { primaryGenre: input.primaryGenre } : {}),
    ...(input.secondaryGenre ? { secondaryGenre: input.secondaryGenre } : {}),
    ...(input.formats?.length
      ? { formats: [...new Set(input.formats)].sort() }
      : {}),
  };
}
interface Entry {
  query: LoadLibraryParams;
  data?: LibraryListResponse;
  generation: number;
  error: unknown;
  used: number;
  pending?: Promise<LibraryListResponse>;
}
export function createLibraryQueryCache(
  fetch: (q: LoadLibraryParams) => Promise<LibraryListResponse>,
  clock: CacheClock,
) {
  const entries = new Map<string, Entry>();
  let version: LibraryVersion | undefined;
  const retiredEpochs = new Set<string>();
  const progress = new Map<number, DownloadProgressEvent>();
  let paused = false;
  let generation = 0,
    disposed = false,
    active: string | null = null,
    visible = false,
    lastStart = -Infinity;
  let cancelScheduled: (() => void) | undefined;
  const listeners = new Set<
    (data: LibraryListResponse | undefined, error: unknown) => void
  >();
  const key = (q: LoadLibraryParams) =>
    JSON.stringify(normalizeLibraryQuery(q));
  const notify = (entry: Entry, error: unknown = entry.error) => {
    if (!disposed && key(entry.query) === active)
      listeners.forEach((fn) => fn(entry.data, error));
  };
  function get(q: LoadLibraryParams) {
    const k = key(q);
    let entry = entries.get(k);
    if (!entry) {
      entry = {
        query: normalizeLibraryQuery(q),
        generation: -1,
        error: null,
        used: clock.now(),
      };
      entries.set(k, entry);
    }
    entry.used = clock.now();
    evict(k);
    return entry;
  }
  function evict(k: string) {
    while (entries.size > 20) {
      const victim = [...entries]
        .filter(([id, e]) => id !== active && id !== k && !e.pending)
        .sort((a, b) => a[1].used - b[1].used)[0];
      if (!victim) break;
      entries.delete(victim[0]);
    }
  }
  function stale(e: Entry) {
    return !e.data || e.generation !== generation;
  }
  function schedule() {
    if (disposed || paused || !visible || !active || cancelScheduled) return;
    cancelScheduled = clock.schedule(
      () => {
        cancelScheduled = undefined;
        const e = entries.get(active!);
        if (!paused && e && stale(e))
          void read(e.query, true).catch(() => undefined);
      },
      Math.max(0, 1000 - (clock.now() - lastStart)),
    );
  }
  async function read(
    q: LoadLibraryParams,
    force = false,
  ): Promise<LibraryListResponse> {
    if (disposed) throw new Error("书架会话已结束");
    const e = get(q);
    if (e.pending) return e.pending;
    if (!force && !stale(e)) return e.data!;
    const startedGeneration = generation;
    lastStart = clock.now();
    e.pending = fetch(e.query)
      .then((data) => {
        if (disposed) throw new Error("书架会话已结束");
        const incoming = data.libraryVersion;
        if (
          incoming &&
          (retiredEpochs.has(incoming.epoch) ||
            (version && incoming.epoch !== version.epoch))
        )
          throw new Error("已忽略旧服务器连接的书架响应");
        const beforeObserved = generation;
        if (incoming) observeVersion(incoming, false);
        const acceptedGeneration =
          startedGeneration === beforeObserved ? generation : startedGeneration;
        const merged = {
          ...data,
          items: data.items.map((book) => {
            const event = progress.get(book.id);
            return event &&
              event.epoch === incoming?.epoch &&
              event.sequence > (data.progressSequence ?? -1) &&
              event.taskId === book.downloadTaskId &&
              ["queued", "downloading"].includes(book.downloadStatus ?? "")
              ? { ...book, downloadProgress: event.progress }
              : book;
          }),
        };
        e.error = null;
        e.data = merged;
        e.generation =
          incoming &&
          version &&
          (incoming.epoch !== version.epoch ||
            incoming.revision < version.revision)
            ? -1
            : acceptedGeneration;
        notify(e);
        return merged;
      })
      .catch((error) => {
        e.error = error;
        notify(e, error);
        throw error;
      })
      .finally(() => {
        e.pending = undefined;
        evict(key(e.query));
        if (e.generation !== generation && generation !== startedGeneration)
          schedule();
      });
    return e.pending;
  }
  function observeVersion(next: LibraryVersion, invalidate = true) {
    if (retiredEpochs.has(next.epoch)) return;
    if (
      version &&
      next.epoch === version.epoch &&
      next.revision <= version.revision
    )
      return;
    if (version && next.epoch !== version.epoch) {
      retiredEpochs.add(version.epoch);
      progress.clear();
    }
    const changed = version !== undefined;
    version = next;
    if (changed) {
      generation++;
      if (invalidate) schedule();
    }
  }
  return {
    setPaused(value: boolean) {
      paused = value;
      if (value) {
        cancelScheduled?.();
        cancelScheduled = undefined;
      } else schedule();
    },
    observeVersion,
    applyProgress(event: DownloadProgressEvent) {
      if (disposed || event.epoch !== version?.epoch) return;
      const previous = progress.get(event.bookId);
      if (previous && event.sequence <= previous.sequence) return;
      progress.set(event.bookId, event);
      for (const e of entries.values())
        if (
          e.data &&
          e.data.libraryVersion?.epoch === event.epoch &&
          event.sequence > (e.data.progressSequence ?? -1) &&
          e.data.items.some(
            (book) =>
              book.id === event.bookId &&
              book.downloadTaskId === event.taskId &&
              ["queued", "downloading"].includes(book.downloadStatus ?? ""),
          )
        ) {
          e.data = {
            ...e.data,
            items: e.data.items.map((book) =>
              book.id === event.bookId &&
              book.downloadTaskId === event.taskId &&
              ["queued", "downloading"].includes(book.downloadStatus ?? "")
                ? { ...book, downloadProgress: event.progress }
                : book,
            ),
          };
          notify(e);
        }
    },
    invalidateDownloadSnapshots() {
      for (const e of entries.values())
        if (
          e.data?.items.some((b) =>
            ["queued", "downloading"].includes(b.downloadStatus ?? ""),
          )
        )
          e.generation = -1;
      schedule();
    },
    revalidate() {
      if (!disposed && visible && active) {
        const e = entries.get(active);
        if (e && stale(e)) schedule();
      }
    },
    read,
    peek(q: LoadLibraryParams) {
      return entries.get(key(q))?.data;
    },
    activate(q: LoadLibraryParams) {
      active = key(q);
      get(q);
    },
    setVisible(value: boolean) {
      visible = value;
      if (!visible) {
        cancelScheduled?.();
        cancelScheduled = undefined;
      }
    },
    subscribe(
      fn: (data: LibraryListResponse | undefined, error: unknown) => void,
    ) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    invalidate() {
      if (disposed) return;
      generation++;
      schedule();
    },
    updateBook(id: number, patch: Partial<LibraryBook>) {
      for (const e of entries.values())
        if (e.data) {
          e.data = {
            ...e.data,
            items: e.data.items.map((b) =>
              b.id === id ? { ...b, ...patch } : b,
            ),
          };
          notify(e);
        }
    },
    dispose() {
      disposed = true;
      cancelScheduled?.();
      entries.clear();
      listeners.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
