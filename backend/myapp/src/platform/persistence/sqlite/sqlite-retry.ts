export class SqliteBusyError extends Error {
  readonly code = "SQLITE_BUSY";
  readonly retryAfterSeconds = 1;

  constructor() {
    super("SQLite database is busy");
    this.name = "SqliteBusyError";
  }
}

export function withSqliteRetry<T>(operation: () => T, maxAttempts = 3): T {
  let lastError: unknown;
  for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt += 1) {
    try {
      return operation();
    } catch (error) {
      lastError = error;
      if (!isSqliteBusy(error)) throw error;
      if (attempt + 1 >= Math.max(1, maxAttempts)) throw new SqliteBusyError();
      const delayMs = 10 * (attempt + 1);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
  throw lastError;
}

function isSqliteBusy(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    code?: unknown;
    errcode?: unknown;
    errstr?: unknown;
    message?: unknown;
  };
  return value.code === "SQLITE_BUSY"
    || value.code === "SQLITE_LOCKED"
    || value.errcode === 5
    || value.errcode === 6
    || value.errstr === "database is locked"
    || value.message === "database is locked";
}
