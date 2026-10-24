const DB_NAME = 'readEveryWhere.bookFileCache';
const DB_VERSION = 2;
const STORE_NAME = 'files';
const CACHE_KEY_PREFIX = 'rew-book-file-v1';
const MAX_CACHE_USAGE_RATIO = 0.85;
const MIN_FREE_BYTES_AFTER_WRITE = 100 * 1024 * 1024;

export interface BookFileCacheEntry {
  cacheKey: string;
  userId: number;
  bookId: number;
  versionKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  bytes: ArrayBuffer;
  createdAt: number;
  lastAccessedAt: number;
}

export interface BookFileCacheDescriptor {
  userId: number;
  bookId: number;
  checksum?: string | null;
  updatedAt: string;
  version: number;
  fileName: string | null;
  mimeType: string | null;
}

const warnCacheFailure = (message: string, error?: unknown) => {
  console.warn(`[bookFileCache] ${message}`, error);
};

const canUseIndexedDb = () => typeof indexedDB !== 'undefined';

const normalizeVersionPart = (value: string | number | null | undefined): string => {
  const normalized = String(value ?? '').trim();
  return normalized || 'unknown';
};

const buildVersionKey = (desc: BookFileCacheDescriptor): string => {
  const checksum = desc.checksum?.trim();
  if (checksum) return `checksum:${checksum}`;

  return [
    'fallback',
    normalizeVersionPart(desc.updatedAt),
    normalizeVersionPart(desc.version),
    normalizeVersionPart(desc.fileName),
    normalizeVersionPart(desc.mimeType),
  ].join(':');
};

export function buildBookFileCacheKey(desc: BookFileCacheDescriptor): string {
  return `${CACHE_KEY_PREFIX}:${desc.userId}:${desc.bookId}:${buildVersionKey(desc)}`;
}

const openDatabase = (): Promise<IDBDatabase | null> => {
  if (!canUseIndexedDb()) return Promise.resolve(null);

  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });

      // v1 stored Blob handles, which can become unreadable after reload on WebKit.
      // Only disposable downloaded-file caches are cleared; reading data is elsewhere.
      if (event.oldVersion === 1) store.clear();

      if (!store.indexNames.contains('userId')) {
        store.createIndex('userId', 'userId', { unique: false });
      }
      if (!store.indexNames.contains('bookId')) {
        store.createIndex('bookId', 'bookId', { unique: false });
      }
      if (!store.indexNames.contains('lastAccessedAt')) {
        store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      warnCacheFailure('IndexedDB 打开失败，已降级为直接下载。', request.error);
      resolve(null);
    };
    request.onblocked = () => {
      warnCacheFailure('IndexedDB 升级被阻塞，已降级为直接下载。');
      resolve(null);
    };
  });
};

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> => (
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  })
);

const waitForTransaction = (transaction: IDBTransaction): Promise<void> => (
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  })
);

const withStore = async <T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => T | Promise<T>,
): Promise<T | null> => {
  const db = await openDatabase();
  if (!db) return null;

  try {
    const transaction = db.transaction(STORE_NAME, mode);
    const done = waitForTransaction(transaction);
    const result = await callback(transaction.objectStore(STORE_NAME));
    await done;
    return result;
  } finally {
    db.close();
  }
};

const getEntry = async (cacheKey: string): Promise<BookFileCacheEntry | null> => {
  const entry = await withStore('readonly', (store) => (
    requestToPromise<BookFileCacheEntry | undefined>(store.get(cacheKey))
  ));
  return entry ?? null;
};

const getAllEntries = async (): Promise<BookFileCacheEntry[]> => {
  const entries = await withStore('readonly', (store) => (
    requestToPromise<BookFileCacheEntry[]>(store.getAll())
  ));
  return entries ?? [];
};

const putEntry = async (entry: BookFileCacheEntry): Promise<boolean> => {
  const result = await withStore('readwrite', (store) => {
    store.put(entry);
    return true;
  });
  return result === true;
};

const deleteKeys = async (keys: IDBValidKey[]): Promise<void> => {
  if (keys.length === 0) return;

  await withStore('readwrite', (store) => {
    keys.forEach((key) => store.delete(key));
  });
};

const deleteOldVersionsForBook = async (
  desc: BookFileCacheDescriptor,
  currentVersionKey: string,
): Promise<void> => {
  const entries = await getAllEntries();
  const staleKeys = entries
    .filter((entry) => (
      entry.userId === desc.userId &&
      entry.bookId === desc.bookId &&
      entry.versionKey !== currentVersionKey
    ))
    .map((entry) => entry.cacheKey);

  await deleteKeys(staleKeys);
};

const pruneLeastRecentlyUsed = async (bytesToFree: number, minimumEntries = 0): Promise<number> => {
  const entries = await getAllEntries();
  entries.sort((left, right) => left.lastAccessedAt - right.lastAccessedAt);

  const keysToDelete: string[] = [];
  let freedBytes = 0;

  for (const entry of entries) {
    if (keysToDelete.length >= minimumEntries && freedBytes >= bytesToFree) break;
    keysToDelete.push(entry.cacheKey);
    freedBytes += entry.size;
  }

  await deleteKeys(keysToDelete);
  return freedBytes;
};

const pruneBeforeWriteIfNeeded = async (incomingBytes: number): Promise<void> => {
  const estimate = typeof navigator !== 'undefined'
    ? await navigator.storage?.estimate?.()
    : undefined;
  const quota = estimate?.quota;
  if (!quota) return;

  const usage = estimate.usage ?? 0;
  const usageAfterWrite = usage + incomingBytes;
  const maxAllowedUsage = quota * MAX_CACHE_USAGE_RATIO;
  const freeBytesAfterWrite = quota - usageAfterWrite;
  const bytesToFree = Math.ceil(Math.max(
    usageAfterWrite - maxAllowedUsage,
    MIN_FREE_BYTES_AFTER_WRITE - freeBytesAfterWrite,
    0,
  ));

  if (bytesToFree > 0) {
    await pruneLeastRecentlyUsed(bytesToFree, 1);
  }
};

const isQuotaExceededError = (error: unknown): boolean => {
  const name = (error as { name?: string } | null)?.name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
};

export async function getCachedBookFile(desc: BookFileCacheDescriptor): Promise<File | null> {
  try {
    const entry = await getEntry(buildBookFileCacheKey(desc));
    if (!entry) return null;

    const now = Date.now();
    if (!(entry.bytes instanceof ArrayBuffer) || entry.bytes.byteLength !== entry.size) {
      await deleteKeys([entry.cacheKey]);
      throw new Error('书籍缓存字节结构或长度无效，已移除该缓存');
    }
    const file = new File([entry.bytes], desc.fileName || entry.fileName || 'book', {
      type: desc.mimeType || entry.mimeType || 'application/octet-stream',
      lastModified: now,
    });

    putEntry({
      ...entry,
      fileName: desc.fileName || entry.fileName,
      mimeType: desc.mimeType || entry.mimeType,
      lastAccessedAt: now,
    }).catch((error) => warnCacheFailure('更新书籍文件缓存访问时间失败。', error));

    return file;
  } catch (error) {
    warnCacheFailure('读取书籍文件缓存失败，已降级为直接下载。', error);
    return null;
  }
}

export async function putCachedBookFile(desc: BookFileCacheDescriptor, blob: Blob): Promise<void> {
  let bytes: ArrayBuffer;
  try {
    bytes = await blob.arrayBuffer();
  } catch (error) {
    warnCacheFailure('无法读取待缓存文件字节，不写入文件缓存。', error);
    return;
  }
  const now = Date.now();
  const versionKey = buildVersionKey(desc);
  const entry: BookFileCacheEntry = {
    cacheKey: buildBookFileCacheKey(desc),
    userId: desc.userId,
    bookId: desc.bookId,
    versionKey,
    fileName: desc.fileName || 'book',
    mimeType: desc.mimeType || blob.type || 'application/octet-stream',
    size: blob.size,
    bytes,
    createdAt: now,
    lastAccessedAt: now,
  };

  const writeEntry = async () => {
    const written = await putEntry(entry);
    if (written) {
      await deleteOldVersionsForBook(desc, versionKey);
    }
  };

  try {
    await pruneBeforeWriteIfNeeded(blob.size);
    await writeEntry();
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      warnCacheFailure('写入书籍文件缓存失败，已降级为直接打开。', error);
      return;
    }

    try {
      await pruneLeastRecentlyUsed(Math.max(blob.size, MIN_FREE_BYTES_AFTER_WRITE), 1);
      await writeEntry();
    } catch (retryError) {
      warnCacheFailure('缓存空间不足，重试后仍无法写入，已降级为直接打开。', retryError);
    }
  }
}

export async function clearBookFileCacheForUser(userId: number): Promise<void> {
  try {
    const entries = await getAllEntries();
    await deleteKeys(
      entries
        .filter((entry) => entry.userId === userId)
        .map((entry) => entry.cacheKey),
    );
  } catch (error) {
    warnCacheFailure('清理用户书籍文件缓存失败。', error);
  }
}

export async function clearBookFileCacheForBook(userId: number, bookId: number): Promise<void> {
  try {
    const entries = await getAllEntries();
    await deleteKeys(
      entries
        .filter((entry) => entry.userId === userId && entry.bookId === bookId)
        .map((entry) => entry.cacheKey),
    );
  } catch (error) {
    warnCacheFailure('清理书籍文件缓存失败。', error);
  }
}
