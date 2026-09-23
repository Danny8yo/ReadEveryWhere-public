import { Global, Module } from "@nestjs/common";
import { AI_DEBUG_LOG_PORT } from "./application/contributions";
import { AiDebugFileLogger } from "./infrastructure/ai-debug-file-logger";

@Global()
@Module({
  providers: [
    AiDebugFileLogger,
    { provide: AI_DEBUG_LOG_PORT, useExisting: AiDebugFileLogger },
  ],
  exports: [AI_DEBUG_LOG_PORT],
})
export class AiModelLoggingModule {}
