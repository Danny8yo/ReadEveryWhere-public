import { Body, Controller, Get, Param, ParseIntPipe, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { Throttle } from "@nestjs/throttler";
import { AppException } from "../../../../platform/http/app-exception";
import { BatchBookAnalysisUseCase } from "../application/use-cases/batch-book-analysis.use-case";
import { GetBookAnalysisUseCase } from "../application/use-cases/get-book-analysis.use-case";
import { RequestBookAnalysisUseCase } from "../application/use-cases/request-book-analysis.use-case";
import { BatchBookAnalysisDto } from "./dto/batch-book-analysis.dto";
import { RequestBookAnalysisDto } from "./dto/request-book-analysis.dto";
import { ApplyBookAnalysisCandidateDto } from "./dto/request-book-analysis.dto";
import { ApplyBookAnalysisCandidateUseCase } from "../application/use-cases/apply-book-analysis-candidate.use-case";
import { throwBookAnalysisHttpError } from "./book-analysis-error.mapper";

@Controller("api/v1/book-analysis")
export class BookAnalysisController {
  constructor(
    private readonly requestAnalysis: RequestBookAnalysisUseCase,
    private readonly batchAnalysis: BatchBookAnalysisUseCase,
    private readonly getAnalysis: GetBookAnalysisUseCase,
    private readonly applyCandidate: ApplyBookAnalysisCandidateUseCase,
  ) {}

  @Post("books/:bookId")
  async analyzeBook(
    @Req() request: Request,
    @Param("bookId", ParseIntPipe) bookId: number,
    @Body() dto: RequestBookAnalysisDto,
  ) {
    try {
      return await this.requestAnalysis.execute(this.userId(request), {
        bookId,
        force: dto.force ?? false,
      });
    } catch (error) {
      throwBookAnalysisHttpError(error);
    }
  }

  @Post("batch")
  async analyzeBatch(@Req() request: Request, @Body() dto: BatchBookAnalysisDto) {
    try {
      return await this.batchAnalysis.execute(this.userId(request), {
        bookIds: dto.bookIds,
        force: dto.force ?? false,
      });
    } catch (error) {
      throwBookAnalysisHttpError(error);
    }
  }

  @Get("books/:bookId")
  @Throttle({ default: { ttl: 60_000, limit: 6_000 } })
  getBookAnalysis(
    @Req() request: Request,
    @Param("bookId", ParseIntPipe) bookId: number,
  ) {
    return this.getAnalysis.execute(this.userId(request), bookId);
  }

  @Post("books/:bookId/apply")
  async applyAnalysisCandidate(
    @Req() request: Request,
    @Param("bookId", ParseIntPipe) bookId: number,
    @Body() dto: ApplyBookAnalysisCandidateDto,
  ) {
    try {
      return await this.applyCandidate.execute(this.userId(request), bookId, dto.candidateId, dto.override ?? false);
    } catch (error) {
      throwBookAnalysisHttpError(error);
    }
  }

  private userId(request: Request): number {
    const userId = request.user?.userId;
    if (!userId) throw AppException.unauthorized("Missing user context");
    return userId;
  }
}
