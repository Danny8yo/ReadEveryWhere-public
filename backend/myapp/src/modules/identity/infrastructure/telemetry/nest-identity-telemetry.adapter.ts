import { Injectable, Logger } from "@nestjs/common";
import type {
  IdentityTelemetryPayload,
  IdentityTelemetryPort,
} from "../../application/ports/identity-telemetry.port";

@Injectable()
export class NestIdentityTelemetryAdapter implements IdentityTelemetryPort {
  private readonly logger = new Logger("AuthService");

  debug(payload: IdentityTelemetryPayload): void {
    this.logger.debug(payload);
  }

  info(payload: IdentityTelemetryPayload): void {
    this.logger.log(payload);
  }

  warn(payload: IdentityTelemetryPayload): void {
    this.logger.warn(payload);
  }
}
