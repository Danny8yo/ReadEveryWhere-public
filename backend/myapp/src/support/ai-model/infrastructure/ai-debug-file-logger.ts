import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import type { AiDebugLogInput, AiDebugLogPort } from "../application/ports/ai-debug-log.port";

interface AiDebugFileLoggerOptions {
  enabled?: boolean;
  directory?: string;
  maxFileBytes?: number;
  retentionDays?: number;
  now?: () => Date;
}

const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 7;
const SENSITIVE_KEY = /^(api.?key|authorization|password|cookie|set.?cookie|client.?secret|encrypted.?api.?key|token|access.?token|refresh.?token|jwt.?secret)$/iu;

export class AiDebugFileLogger implements AiDebugLogPort {
  private readonly enabled: boolean;
  private readonly directory: string;
  private readonly maxFileBytes: number;
  private readonly retentionDays: number;
  private readonly now: () => Date;
  private lastCleanupDate = "";

  constructor(options: AiDebugFileLoggerOptions = {}) {
    this.enabled = options.enabled ?? process.env.AI_DEBUG_LOG_ENABLED === "true";
    this.directory = resolve(
      options.directory ?? process.env.AI_DEBUG_LOG_PATH ?? "data/ai-debug",
    );
    this.maxFileBytes = positiveInteger(
      options.maxFileBytes ?? megabytes(process.env.AI_DEBUG_LOG_MAX_FILE_MB),
      DEFAULT_MAX_FILE_BYTES,
    );
    this.retentionDays = positiveInteger(
      options.retentionDays ?? Number(process.env.AI_DEBUG_LOG_RETENTION_DAYS),
      DEFAULT_RETENTION_DAYS,
    );
    this.now = options.now ?? (() => new Date());
  }

  write(input: AiDebugLogInput): void {
    if (!this.enabled) return;
    try {
      const timestamp = this.now();
      const date = timestamp.toISOString().slice(0, 10);
      this.prepareDirectory(date, timestamp);
      const secrets = (input.secrets ?? []).filter((value) => value.length >= 4);
      const record = {
        timestamp: timestamp.toISOString(),
        event: input.event,
        ...(input.trace ? { trace: sanitize(input.trace, secrets) } : {}),
        ...(input.data !== undefined ? { data: sanitize(input.data, secrets) } : {}),
      };
      const line = `${JSON.stringify(record)}\n`;
      const filePath = this.fileFor(date, Buffer.byteLength(line));
      appendFileSync(filePath, line, { encoding: "utf8", mode: 0o600 });
      chmodSync(filePath, 0o600);
    } catch {
      // Debug logging is observational and must never change task behavior.
    }
  }

  private prepareDirectory(date: string, now: Date): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    chmodSync(this.directory, 0o700);
    if (this.lastCleanupDate === date) return;
    this.lastCleanupDate = date;
    const cutoff = now.getTime() - this.retentionDays * 24 * 60 * 60 * 1_000;
    for (const name of readdirSync(this.directory)) {
      if (!/^ai-debug-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.jsonl$/u.test(name)) continue;
      const filePath = resolve(this.directory, name);
      if (statSync(filePath).mtimeMs < cutoff) unlinkSync(filePath);
    }
  }

  private fileFor(date: string, incomingBytes: number): string {
    for (let index = 0; ; index += 1) {
      const suffix = index === 0 ? "" : `.${index}`;
      const filePath = resolve(this.directory, `ai-debug-${date}${suffix}.jsonl`);
      if (!existsSync(filePath) || statSync(filePath).size + incomingBytes <= this.maxFileBytes) {
        return filePath;
      }
    }
  }
}

function sanitize(value: unknown, secrets: readonly string[], depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 20) return "[TRUNCATED_DEPTH]";
  if (typeof value === "string") return redactSecrets(value, secrets);
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, secrets, depth + 1, seen));
  if (value instanceof Error) {
    return { name: value.name, message: redactSecrets(value.message, secrets) };
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitize(item, secrets, depth + 1, seen),
  ]));
}

function redactSecrets(value: string, secrets: readonly string[]): string {
  return secrets.reduce((output, secret) => output.split(secret).join("[REDACTED]"), value);
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function megabytes(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed * 1024 * 1024) : 0;
}
