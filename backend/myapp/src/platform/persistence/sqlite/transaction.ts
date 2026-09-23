import type { DatabaseSync } from "node:sqlite";

interface Context {
  callbacks: Array<() => void>;
  failed?: boolean;
}
const contexts = new WeakMap<DatabaseSync, Context>();

/** Synchronous only: callbacks run after the outermost COMMIT, never inside retry/rollback. */
export function transact<T>(database: DatabaseSync, mutation: () => T): T {
  const existing = contexts.get(database);
  if (existing) {
    try {
      const value = mutation();
      if (value instanceof Promise)
        throw new Error("SQLite transaction callback must be synchronous");
      return value;
    } catch (error) {
      existing.failed = true;
      throw error;
    }
  }
  if (database.isTransaction)
    throw new Error("Cannot join an unmanaged SQLite transaction");
  const context: Context = { callbacks: [] };
  database.exec("BEGIN IMMEDIATE");
  contexts.set(database, context);
  let value: T;
  try {
    value = mutation();
    if (value instanceof Promise)
      throw new Error("SQLite transaction callback must be synchronous");
    if (context.failed)
      throw new Error(
        "Nested SQLite transaction failed; refusing partial commit",
      );
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    contexts.delete(database);
  }
  // A callback error is a post-commit failure; it must never retry the mutation.
  const errors: unknown[] = [];
  for (const callback of context.callbacks) {
    try {
      callback();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(
      errors,
      "SQLite committed, but after-commit effects failed",
    );
  return value;
}

export function afterCommit(
  database: DatabaseSync,
  callback: () => void,
): void {
  const context = contexts.get(database);
  if (context) {
    context.callbacks.push(callback);
    return;
  }
  if (database.isTransaction)
    throw new Error("afterCommit requires a managed SQLite transaction");
  callback();
}
