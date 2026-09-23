import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { AppException } from "../../../../../platform/http/app-exception";
import { SearchService } from "../../application/search.service";
import type { SearchPageResult } from "../../domain/search-result.types";
import { throwAcquisitionHttpError } from "../../../presentation/http/acquisition-error.mapper";
import { SearchQueryDto } from "./dto/search-query.dto";

@Controller("api/v1/search")
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post("books")
  @HttpCode(200)
  async searchBooks(@Body() query: SearchQueryDto, @Req() req: Request): Promise<SearchPageResult> {
    const requestId = query.requestId ?? req.requestId;
    if (!requestId) {
      throw AppException.internal("requestId is missing");
    }
    try {
      return await this.searchService.searchBooks(query, requestId, req.user?.userId);
    } catch (error) {
      throwAcquisitionHttpError(error);
    }
  }
}
