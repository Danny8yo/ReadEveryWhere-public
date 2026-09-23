import { Controller, Get, Param, Req } from "@nestjs/common";
import type { Request } from "express";
import { AppException } from "../../../../platform/http/app-exception";
import { ReaderToolException } from "../../../intelligent-library/public";
import { SelectionQaError } from "../application/selection-qa.types";
import { SelectionQaLocationService } from "../application/selection-qa-location.service";
@Controller("api/v1/selection-qa")
export class SelectionQaLocationController {
  constructor(private readonly locations: SelectionQaLocationService) {}
  @Get("conversations/:id/location") conversation(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.resolve(req, { conversationId: id });
  }
  @Get("turns/:id/evidence/:evidenceId/location") evidence(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("evidenceId") evidenceId: string,
  ) {
    return this.resolve(req, { turnId: id, evidenceId });
  }
  private async resolve(
    req: Request,
    input: Parameters<SelectionQaLocationService["resolve"]>[1],
  ) {
    if (!req.user) throw AppException.unauthorized();
    try {
      return await this.locations.resolve(req.user.userId, input);
    } catch (error) {
      if (error instanceof ReaderToolException)
        throw new AppException(
          error.status,
          error.code,
          error.message,
          error.details,
        );
      if (error instanceof SelectionQaError)
        throw new AppException(
          error.status,
          error.status === 404 ? 40401 : 40003,
          error.message,
          { reason: error.code },
        );
      throw error;
    }
  }
}
