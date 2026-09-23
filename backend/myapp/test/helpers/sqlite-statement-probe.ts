import type { DatabaseSync } from "node:sqlite";

export type SqliteExecutionKind = "all" | "exec" | "get" | "iterate" | "run";

export interface SqliteStatementExecution {
  kind: SqliteExecutionKind;
  sql: string;
}

export interface SqliteStatementProbe {
  database: DatabaseSync;
  executions: SqliteStatementExecution[];
  reset(): void;
}

export function createSqliteStatementProbe(target: DatabaseSync): SqliteStatementProbe {
  const executions: SqliteStatementExecution[] = [];
  const normalized = (sql: string) => sql.replace(/\s+/g, " ").trim();

  const database = new Proxy(target as unknown as Record<PropertyKey, unknown>, {
    get(databaseTarget, property) {
      if (property === "exec") {
        return (sql: string) => {
          executions.push({ kind: "exec", sql: normalized(sql) });
          return target.exec(sql);
        };
      }

      if (property === "prepare") {
        return (sql: string) => {
          const statement = target.prepare(sql);
          return new Proxy(statement as unknown as Record<PropertyKey, unknown>, {
            get(statementTarget, statementProperty) {
              const value = Reflect.get(statementTarget, statementProperty);
              if (
                typeof value === "function"
                && ["all", "get", "iterate", "run"].includes(String(statementProperty))
              ) {
                return (...args: unknown[]) => {
                  executions.push({
                    kind: statementProperty as SqliteExecutionKind,
                    sql: normalized(sql),
                  });
                  return value.apply(statement, args);
                };
              }
              return typeof value === "function" ? value.bind(statement) : value;
            },
          });
        };
      }

      const value = Reflect.get(databaseTarget, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as DatabaseSync;

  return {
    database,
    executions,
    reset: () => {
      executions.length = 0;
    },
  };
}
