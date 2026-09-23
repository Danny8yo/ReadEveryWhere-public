import { Body, Controller, Delete, Get, Post, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { AppException } from "../../../../platform/http/app-exception";
import { ModelConfigError, ModelConfigService } from "../../application/model-config.service";
import { SaveModelConfigDto } from "./dto/model-config.dto";

@Controller("api/v1/ai-reading")
export class ModelConfigController {
  constructor(private readonly service: ModelConfigService) {}

  @Get("model-config")
  get(@Req() request: Request) {
    return this.mapError(() => this.service.get(this.userId(request)));
  }

  @Put("model-config")
  save(@Req() request: Request, @Body() dto: SaveModelConfigDto) {
    return this.mapError(() => this.service.save(this.userId(request), dto));
  }

  @Delete("model-config")
  remove(@Req() request: Request) {
    return this.mapError(() => this.service.remove(this.userId(request)));
  }

  @Post("model-config/test")
  async test(@Req() request: Request, @Body() dto: SaveModelConfigDto) {
    try {
      return await this.service.test(this.userId(request), dto);
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  private userId(request: Request): number {
    if (!request.user?.userId) throw AppException.unauthorized("Missing user context");
    return request.user.userId;
  }

  private mapError<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  private toHttpError(error: unknown): unknown {
    if (!(error instanceof ModelConfigError)) return error;
    if (error.kind === "validation") {
      return AppException.validation(error.details.field, error.message);
    }
    return new AppException(400, 40002, error.message, {
      field: error.details.field,
      reason: error.details.reason ?? "DEEPSEEK_MODEL_UNSUPPORTED",
    });
  }
}
