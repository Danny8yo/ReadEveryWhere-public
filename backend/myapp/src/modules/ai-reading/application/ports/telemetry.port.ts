export interface TelemetryRecord {
  event: string;
  [key: string]: unknown;
}

export interface TelemetryPort {
  info(record: TelemetryRecord): void;
  warn(record: TelemetryRecord): void;
  error(record: TelemetryRecord): void;
}

export const NOOP_TELEMETRY: TelemetryPort = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});
