import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { AppException } from "../../../../platform/http/app-exception";
import { MetadataOrchestratorService } from "../application/metadata-orchestrator.service";
import { SearchDoubanRatingUseCase } from "../application/search-douban-rating.use-case";
import { ApplyMetadataUseCase } from "../application/use-cases/apply-metadata.use-case";
import { throwCatalogHttpError } from "../../library-queries/presentation/http/catalog-error.mapper";
import { ApplyMetadataDto } from "./dto/apply-metadata.dto";
import { SaveDoubanRatingUseCase } from "../application/save-douban-rating.use-case";
import { SaveDoubanRatingDto } from "./dto/save-douban-rating.dto";
import { ScrapeMetadataDto } from "./dto/scrape-metadata.dto";

@Controller("api/v1/metadata")
export class MetadataController {
  constructor(
    private readonly orchestrator: MetadataOrchestratorService,
    private readonly applyMetadataUseCase: ApplyMetadataUseCase,
    private readonly searchDoubanRating: SearchDoubanRatingUseCase,
    private readonly saveDoubanRating: SaveDoubanRatingUseCase,
  ) {}

  @Post("scrape")
  async scrape(@Body() dto: ScrapeMetadataDto, @Req() req: Request) {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized();
    if (!dto.bookId || (dto.provider !== "AI" && !dto.keyword?.trim())) {
      throw AppException.validation(!dto.bookId ? "bookId" : "keyword", "The selected provider requires this field");
    }
    try {
      return await this.orchestrator.scrape(dto.provider, {
        userId,
        requestId: req.requestId ?? "",
        keyword: dto.keyword?.trim(),
        bookId: dto.bookId,
      });
    } catch (error) {
      throwCatalogHttpError(error);
    }
  }

  @Put("books/:id/douban-rating")
  saveRating(
    @Param("id", ParseIntPipe) bookId: number,
    @Body() dto: SaveDoubanRatingDto,
    @Req() req: Request,
  ) {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized();
    try {
      return {
        provider: "douban" as const,
        ...this.saveDoubanRating.execute(userId, bookId, dto),
      };
    } catch (error) {
      throwCatalogHttpError(error);
    }
  }

  @Get("douban-rating")
  async doubanRating(@Query("q") keyword: string, @Req() req: Request) {
    const normalizedKeyword = typeof keyword === "string" ? keyword.trim() : "";
    if (!normalizedKeyword) {
      throw AppException.validation("q", "Keyword is required");
    }
    if (normalizedKeyword.length > 100) {
      throw AppException.validation("q", "Keyword is too long");
    }

    return this.searchDoubanRating.execute(
      req.user?.userId,
      normalizedKeyword,
      req.requestId ?? "",
    );
  }

  @Patch("books/:id")
  apply(
    @Param("id", ParseIntPipe) bookId: number,
    @Body() dto: ApplyMetadataDto,
    @Req() req: Request,
  ) {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized();
    }
    try {
      return this.applyMetadataUseCase.execute(userId, bookId, dto);
    } catch (error) {
      throwCatalogHttpError(error);
    }
  }

}
