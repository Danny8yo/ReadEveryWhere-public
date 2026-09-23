import { Injectable, Logger } from "@nestjs/common";
import type {
  TelemetryPort,
  TelemetryRecord,
} from "../application/ports/telemetry.port";

@Injectable()
export class NestTelemetryAdapter implements TelemetryPort {
  private readonly logger = new Logger("AgentRunExecutor");

  info(record: TelemetryRecord): void {
    this.logger.log(record);
  }

  warn(record: TelemetryRecord): void {
    this.logger.warn(record);
  }

  error(record: TelemetryRecord): void {
    this.logger.error(record);
  }
}
