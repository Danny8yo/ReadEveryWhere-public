import { Body, Controller, Get, Put, Query, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { AppException } from "../../../../platform/http/app-exception";
import { throwReadingStateHttpError } from "../../presentation/http/reading-state-error.mapper";
import type { ProgressLocationType } from "../domain/reading-progress.types";
import { UpsertProgressUseCase } from "../application/use-cases/upsert-progress.use-case";
import { GetProgressUseCase } from "../application/use-cases/get-progress.use-case";
import { UpsertProgressDto } from "./dto/upsert-progress.dto";
import { GetProgressDto } from "./dto/get-progress.dto";

@Controller("api/v1/progress")
export class ReadingProgressController {
  constructor(
    private readonly upsertProgressUseCase: UpsertProgressUseCase,
    private readonly getProgressUseCase: GetProgressUseCase,
  ) {}

  @Put()
  upsert(@Req() req: Request, @Body() dto: UpsertProgressDto) {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized();
    try {
      return this.upsertProgressUseCase.execute(userId, {
        bookId: dto.bookId,
        bookHash: dto.bookHash ?? "",
        location: dto.location,
        locationType: (dto.locationType ?? "epubcfi") as ProgressLocationType,
        fraction: dto.fraction,
        deviceId: dto.deviceId,
        deviceSequence: dto.deviceSequence,
      });
    } catch (error) {
      throwReadingStateHttpError(error);
    }
  }

  // 读进度频繁轮询/打开书时调用：放宽而非取消限流——给一个专用高配额
  // （60s 内 600 次≈10 req/s），既够多端同步不误触 429，又避免完全无界被滥用。
  @Throttle({ default: { ttl: 60000, limit: 600 } })
  @Get()
  get(@Req() req: Request, @Query() query: GetProgressDto) {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized();
    return this.getProgressUseCase.execute(userId, query.bookId);
  }
}
