import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseInterceptors } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { AppException } from "../../../platform/http/app-exception";
import { AiReadingService } from "../application/ai-reading.service";
import { ReadingConversationService } from "../application/reading-conversation.service";
import {
  CreateReadingConversationDto,
  CreateReadingConversationTurnDto,
  ListConversationTurnsDto,
  ListReadingConversationsDto,
  ListReadingEventsDto,
  RetryReadingConversationTurnDto,
} from "./dto/ai-reading.dto";
import { AiReadingApplicationErrorInterceptor } from "./ai-reading-application-error.interceptor";

@Controller("api/v1/ai-reading")
@UseInterceptors(AiReadingApplicationErrorInterceptor)
export class AiReadingController {
  constructor(
    private readonly service: AiReadingService,
    private readonly conversations: ReadingConversationService,
  ) {}

  @Get("budget-config")
  getBudgetConfig() {
    return this.service.getBudgetConfig();
  }

  @Post("conversations")
  createConversation(@Req() request: Request, @Body() dto: CreateReadingConversationDto) {
    return this.conversations.createConversation(this.userId(request), dto, request.requestId);
  }

  @Get("conversations")
  listConversations(@Req() request: Request, @Query() query: ListReadingConversationsDto) {
    return this.conversations.listConversations(
      this.userId(request), query.bookId, query.page, query.pageSize,
    );
  }

  @Get("conversations/:conversationId")
  getConversation(@Req() request: Request, @Param("conversationId") conversationId: string) {
    return this.conversations.getConversation(this.userId(request), conversationId);
  }

  @Delete("conversations/:conversationId")
  deleteConversation(@Req() request: Request, @Param("conversationId") conversationId: string) {
    return this.conversations.deleteConversation(this.userId(request), conversationId);
  }

  @Post("conversations/:conversationId/turns")
  createConversationTurn(
    @Req() request: Request,
    @Param("conversationId") conversationId: string,
    @Body() dto: CreateReadingConversationTurnDto,
  ) {
    return this.conversations.createTurn(this.userId(request), conversationId, dto, request.requestId);
  }

  @Get("conversations/:conversationId/turns")
  listConversationTurns(
    @Req() request: Request,
    @Param("conversationId") conversationId: string,
    @Query() query: ListConversationTurnsDto,
  ) {
    return this.conversations.listTurns(
      this.userId(request), conversationId, query.beforeTurnNumber ?? null, query.pageSize,
    );
  }

  @Get("conversations/:conversationId/turns/:turnId")
  getConversationTurn(
    @Req() request: Request,
    @Param("conversationId") conversationId: string,
    @Param("turnId") turnId: string,
  ) {
    const userId = this.userId(request);
    const turn = this.conversations.getTurn(userId, conversationId, turnId);
    return { ...turn, task: this.service.getTask(userId, turn.taskId) };
  }

  @SkipThrottle()
  @Get("conversations/:conversationId/turns/:turnId/events")
  listConversationTurnEvents(
    @Req() request: Request,
    @Param("conversationId") conversationId: string,
    @Param("turnId") turnId: string,
    @Query() query: ListReadingEventsDto,
  ) {
    const userId = this.userId(request);
    const turn = this.conversations.getTurn(userId, conversationId, turnId);
    return this.service.listEvents(userId, turn.taskId, query.afterSequence, query.limit);
  }

  @Post("conversations/:conversationId/turns/:turnId/cancel")
  cancelConversationTurn(
    @Req() request: Request,
    @Param("conversationId") conversationId: string,
    @Param("turnId") turnId: string,
  ) {
    const userId = this.userId(request);
    const turn = this.conversations.getTurn(userId, conversationId, turnId);
    return this.service.cancelTask(userId, turn.taskId);
  }

  @Post("conversations/:conversationId/turns/:turnId/retry")
  retryConversationTurn(
    @Req() request: Request,
    @Param("conversationId") conversationId: string,
    @Param("turnId") turnId: string,
    @Body() dto: RetryReadingConversationTurnDto,
  ) {
    return this.conversations.retryTurn(
      this.userId(request), conversationId, turnId, dto, request.requestId,
    );
  }

  private userId(request: Request): number {
    if (!request.user?.userId) throw AppException.unauthorized("Missing user context");
    return request.user.userId;
  }
}
