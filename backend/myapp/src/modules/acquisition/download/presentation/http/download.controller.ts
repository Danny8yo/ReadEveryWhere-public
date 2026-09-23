import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Req } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { AppException } from "../../../../../platform/http/app-exception";
import { CancelDownloadTaskUseCase } from "../../application/use-cases/cancel-download-task.use-case";
import { CreateDownloadTaskUseCase } from "../../application/use-cases/create-download-task.use-case";
import { GetDownloadTaskUseCase } from "../../application/use-cases/get-download-task.use-case";
import { throwAcquisitionHttpError } from "../../../presentation/http/acquisition-error.mapper";
import { CreateDownloadTaskDto } from "./dto/create-download-task.dto";

@Controller("api/v1/downloads")
export class DownloadController {
  constructor(
    private readonly createDownloadTaskUseCase: CreateDownloadTaskUseCase,
    private readonly getDownloadTaskUseCase: GetDownloadTaskUseCase,
    private readonly cancelDownloadTaskUseCase: CancelDownloadTaskUseCase,
  ) {}

  @Post("tasks")
  @HttpCode(201)
  async createTask(@Req() req: Request, @Body() dto: CreateDownloadTaskDto) {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }

    try {
      return await this.createDownloadTaskUseCase.execute(userId, dto);
    } catch (error) {
      throwAcquisitionHttpError(error);
    }
  }

  @SkipThrottle()
  @Get("tasks/:taskId")
  getTask(@Req() req: Request, @Param("taskId", ParseIntPipe) taskId: number) {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }

    try {
      return this.getDownloadTaskUseCase.execute(userId, taskId);
    } catch (error) {
      throwAcquisitionHttpError(error);
    }
  }

  @Delete("tasks/:taskId")
  @HttpCode(200)
  cancelTask(@Req() req: Request, @Param("taskId", ParseIntPipe) taskId: number) {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }

    try {
      return this.cancelDownloadTaskUseCase.execute(userId, taskId);
    } catch (error) {
      throwAcquisitionHttpError(error);
    }
  }
}
