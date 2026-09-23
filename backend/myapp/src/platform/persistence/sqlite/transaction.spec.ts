import { DatabaseSync } from "node:sqlite";
import { afterCommit, transact } from "./transaction";
describe("SQLite after-commit boundary", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE facts(value INTEGER)");
  });
  afterEach(() => db.close());
  it("publishes nested changes only after the outer commit", () => {
    const calls: boolean[] = [];
    transact(db, () => {
      transact(db, () => {
        db.exec("INSERT INTO facts VALUES(1)");
        afterCommit(db, () => calls.push(db.isTransaction));
      });
      expect(calls).toEqual([]);
    });
    expect(calls).toEqual([false]);
  });
  it("rolls back all changes and callbacks after an outer failure", () => {
    const called = jest.fn();
    expect(() =>
      transact(db, () => {
        transact(db, () => {
          db.exec("INSERT INTO facts VALUES(1)");
          afterCommit(db, called);
        });
        throw Error("reject candidate");
      }),
    ).toThrow("reject candidate");
    expect(db.prepare("SELECT * FROM facts").all()).toEqual([]);
    expect(called).not.toHaveBeenCalled();
  });
  it("refuses a partial commit when a caught nested failure poisoned the transaction", () => {
    expect(() =>
      transact(db, () => {
        try {
          transact(db, () => {
            db.exec("INSERT INTO facts VALUES(1)");
            throw Error("nested");
          });
        } catch {}
      }),
    ).toThrow("refusing partial commit");
    expect(db.prepare("SELECT * FROM facts").all()).toEqual([]);
  });
  it("does not roll back or retry a committed write after an effect fails", () => {
    const next = jest.fn();
    expect(() =>
      transact(db, () => {
        db.exec("INSERT INTO facts VALUES(1)");
        afterCommit(db, () => {
          throw Error("effect");
        });
        afterCommit(db, next);
      }),
    ).toThrow("committed");
    expect(db.prepare("SELECT * FROM facts").all()).toHaveLength(1);
    expect(next).toHaveBeenCalledTimes(1);
  });
  it("rejects unmanaged transactions", () => {
    db.exec("BEGIN");
    expect(() => afterCommit(db, () => {})).toThrow("managed");
    db.exec("ROLLBACK");
  });
});
