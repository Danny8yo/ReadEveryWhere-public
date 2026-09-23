import { SseTransport } from "../../../platform/realtime/sse-transport";
import { SESSION_VALIDITY_PORT, type SessionValidityPort } from "../../identity/public";
import { Controller, Get, Inject, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AppException } from "../../../platform/http/app-exception";
import { GetReadingStateUseCase } from "../application/get-reading-state.use-case";
import { ReadingStateEventBus } from "../application/reading-state-event-bus";
import { throwReadingStateHttpError } from "./http/reading-state-error.mapper";
import { GetReadingStateDto, StreamReadingStateDto } from "./dto/get-reading-state.dto";

@Controller("api/v1/reading-state")
export class ReadingStateController {
  constructor(
    private readonly getReadingState: GetReadingStateUseCase,
    private readonly events: ReadingStateEventBus,
    private readonly transport: SseTransport,
    @Inject(SESSION_VALIDITY_PORT) private readonly sessions: SessionValidityPort,
  ) {}

  @Get()
  getSnapshot(@Req() req: Request, @Query() query: GetReadingStateDto) {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized();
    try {
      return this.getReadingState.execute(userId, query.bookId);
    } catch (error) {
      throwReadingStateHttpError(error);
    }
  }

  @Get("stream")
  stream(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: StreamReadingStateDto,
  ): void {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized();
    try {
      this.getReadingState.execute(userId, query.bookId);
    } catch (error) {
      throwReadingStateHttpError(error);
    }

    if (!req.user?.sessionId) throw AppException.unauthorized();
    const sessionId = req.user.sessionId;
    this.transport.open(req, res, () => this.sessions.isActive({ userId, sessionId }), sink =>
      this.events.subscribe({ userId, bookId: query.bookId }, event => {
        if (query.deviceId && event.sourceDeviceId === query.deviceId) return;
        sink.send("reading_state_changed", { bookId: event.bookId, revision: event.revision, changed: event.changed });
      }), () => ({}));
  }
}
