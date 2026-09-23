import { SqliteBusyError, withSqliteRetry } from "./sqlite-retry";

describe("withSqliteRetry", () => {
  it("retries a pure SQLite operation within the bound", () => {
    let attempts = 0;
    expect(withSqliteRetry(() => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("database is locked") as Error & { code: string };
        error.code = "SQLITE_BUSY";
        throw error;
      }
      return "saved";
    })).toBe("saved");
    expect(attempts).toBe(3);
  });

  it("fails closed with a stable busy error after the bound", () => {
    expect(() => withSqliteRetry(() => {
      throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    }, 2)).toThrow(SqliteBusyError);
  });
});
