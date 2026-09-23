import { Controller, Get, Header, Inject, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  SESSION_VALIDITY_PORT,
  type SessionValidityPort,
} from "../../identity/public";
import { AppException } from "../../../platform/http/app-exception";
import { SseTransport } from "../../../platform/realtime/sse-transport";
import { LibrarySyncState } from "./library-sync-state";
@Controller("api/v1/library")
export class LibrarySyncController {
  constructor(
    private readonly sync: LibrarySyncState,
    private readonly transport: SseTransport,
    @Inject(SESSION_VALIDITY_PORT)
    private readonly sessions: SessionValidityPort,
  ) {}
  @Get("sync-state")
  @Header("Cache-Control", "no-store")
  state(@Req() req: Request) {
    if (!req.user) throw AppException.unauthorized();
    return { libraryVersion: this.sync.version(req.user.userId) };
  }
  @Get("stream")
  stream(@Req() req: Request, @Res() res: Response): void {
    if (!req.user?.sessionId) throw AppException.unauthorized();
    const { userId, sessionId } = req.user;
    this.transport.open(
      req,
      res,
      () => this.sessions.isActive({ userId, sessionId }),
      (sink) =>
        this.sync.subscribe(
          userId,
          (event) => sink.send(event.name, event.data),
          sink.close,
        ),
      () => ({ libraryVersion: this.sync.version(userId) }),
    );
  }
}
