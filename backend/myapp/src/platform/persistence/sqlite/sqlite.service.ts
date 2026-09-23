import { initializeSchema } from "./schema-migrations";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";

@Injectable()
export class SqliteService implements OnModuleInit {
  private readonly logger = new Logger(SqliteService.name);
  private readonly database: DatabaseSync;

  constructor() {
    const databasePath = resolve(
      process.cwd(),
      process.env.SQLITE_PATH ?? "data/read-everywhere.sqlite",
    );
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
    `);
  }

  onModuleInit(): void {
    initializeSchema(this.database);
  }

  onApplicationShutdown(): void {
    this.database.close();
  }
  getDatabase(): DatabaseSync {
    return this.database;
  }
}
