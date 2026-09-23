export type IdentityTelemetryPayload = Readonly<Record<string, unknown>>;

export interface IdentityTelemetryPort {
  debug(payload: IdentityTelemetryPayload): void;
  info(payload: IdentityTelemetryPayload): void;
  warn(payload: IdentityTelemetryPayload): void;
}

export const IDENTITY_TELEMETRY_PORT = Symbol("IDENTITY_TELEMETRY_PORT");
