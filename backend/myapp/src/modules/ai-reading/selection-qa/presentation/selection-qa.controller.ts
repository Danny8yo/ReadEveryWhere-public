import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ReaderToolException } from "../../../intelligent-library/public";
import { AppException } from "../../../../platform/http/app-exception";
import { SelectionQaService } from "../application/selection-qa.service";
import {
  SelectionQaError,
} from "../application/selection-qa.types";
import {
  ApplyAnnotationDto,
  CreateConversationDto,
  CreateTurnDto,
  EventQueryDto,
  HistoryQueryDto,
  ResolveSelectionDto,
  TurnPageDto,
} from "./selection-qa.dto";
@Controller("api/v1/selection-qa")
export class SelectionQaController {
  private readonly logger = new Logger(SelectionQaController.name);
  constructor(private readonly service: SelectionQaService) {}
  private user(req: Request): number {
    if (!req.user) throw AppException.unauthorized();
    return req.user.userId;
  }
  private async execute<T>(fn: () => T | Promise<T>): Promise<T> {
    try {
      return await fn();
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
          error.status >= 500
            ? 50001
            : error.status === 404
              ? 40401
              : error.status === 400
                ? 40002
                : 40003,
          error.message,
          { reason: error.code, current: error.current },
        );
      throw error;
    }
  }
  @Post("selections/resolve") resolve(
    @Req() req: Request,
    @Body() input: ResolveSelectionDto,
  ) {
    return this.execute(() =>
      this.service.resolve(this.user(req), input.bookId, input.selection),
    );
  }
  @Post("conversations") create(
    @Req() req: Request,
    @Body() input: CreateConversationDto,
  ) {
    if (input.question.length > 4000) throw AppException.validation("question");
    return this.execute(() => this.service.create(this.user(req), input));
  }
  @Get("conversations") list(
    @Req() req: Request,
    @Query() query: HistoryQueryDto,
  ) {
    return this.execute(() =>
      this.service.list(
        this.user(req),
        query.bookId,
        query.cursor,
        query.limit,
      ),
    );
  }
  @Get("conversations/:id") get(@Req() req: Request, @Param("id") id: string) {
    return this.execute(() => this.service.get(this.user(req), id));
  }
  @Get("conversations/:id/turns") turns(
    @Req() req: Request,
    @Param("id") id: string,
    @Query() query: TurnPageDto,
  ) {
    return this.execute(() =>
      this.service.turns(this.user(req), id, query.cursor, query.limit),
    );
  }
  @Post("conversations/:id/turns") addTurn(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: CreateTurnDto,
  ) {
    if (input.question.length > 4000) throw AppException.validation("question");
    return this.execute(() => this.service.addTurn(this.user(req), id, input));
  }
  @Post("turns/:id/stop") stop(@Req() req: Request, @Param("id") id: string) {
    return this.execute(() => this.service.stop(this.user(req), id));
  }
  @Delete("conversations/:id") delete(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.execute(() => this.service.delete(this.user(req), id));
  }
  @Post("turns/:id/apply-annotation") apply(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: ApplyAnnotationDto,
  ) {
    if (input.appendText.length > 50000)
      throw AppException.validation("appendText");
    const target = input.target;
    if (!target) throw AppException.validation("target");
    if (target.kind === "append") {
      if (
        !target.annotationId ||
        !target.expectedRevision ||
        target.annotationType !== undefined ||
        target.color !== undefined ||
        target.cfi !== undefined ||
        target.chapterLabel !== undefined
      )
        throw AppException.validation("target");
      return this.execute(() =>
        this.service.apply(this.user(req), id, {
          ...input,
          target: {
            kind: "append",
            annotationId: target.annotationId!,
            expectedRevision: target.expectedRevision!,
          },
        }),
      );
    }
    if (
      !target.annotationType ||
      !target.color ||
      !target.cfi ||
      target.annotationId !== undefined ||
      target.expectedRevision !== undefined
    )
      throw AppException.validation("target");
    return this.execute(() =>
      this.service.apply(this.user(req), id, {
        ...input,
        target: {
          kind: "create",
          annotationType: target.annotationType!,
          color: target.color!,
          cfi: target.cfi!,
          chapterLabel: target.chapterLabel,
        },
      }),
    );
  }
  @Get("turns/:id/events") async events(
    @Req() req: Request,
    @Param("id") id: string,
    @Query() query: EventQueryDto,
    @Res() res: Response,
  ) {
    const user = this.user(req);
    let sequence = query.afterSequence;
    await this.execute(() => this.service.events(user, id, sequence));
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const connectedAt = Date.now();
    let closed = false, blocked = false, sent = 0, deltas = 0;
    let firstDeltaAt: number | null = null;
    let deliveryTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let scheduled: ReturnType<typeof setImmediate> | undefined;
    let unsubscribe = () => {};
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      clearInterval(heartbeat);
      clearTimeout(deliveryTimer);
      clearImmediate(scheduled);
      res.off("drain", resume);
      req.off("aborted", close);
      res.off("close", close);
      this.logger.log({ event: "selection_qa.sse_closed", turnId: id, connectedAt, firstDeltaAt, elapsedMs: Date.now() - connectedAt, sent, deltas, lastSequence: sequence });
    };
    const pump = () => {
      if (closed || blocked) return;
      try {
        const events = this.service.events(user, id, sequence);
        for (const event of events) {
          const ready = res.write(`id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
          sequence = event.sequence;
          sent++;
          if (event.kind === "answer_delta") {
            deltas++;
            if (firstDeltaAt === null) {
              firstDeltaAt = Date.now();
              this.logger.log({ event: "selection_qa.sse_first_delta", turnId: id, sequence, at: firstDeltaAt, elapsedMs: firstDeltaAt - connectedAt });
            }
          }
          if (!ready) { blocked = true; return; }
        }
        if (events.length === 200) {
          if (!scheduled) scheduled = setImmediate(() => { scheduled = undefined; pump(); });
        } else if (!["queued", "running"].includes(this.service.getTurn(user, id).status)) {
          close(); res.end();
        }
      } catch (error) {
        if (!(error instanceof SelectionQaError && error.status === 404))
          this.logger.error({ turnId: id, error: error instanceof Error ? error.stack : String(error) }, "Selection QA stream failed");
        close(); res.end();
      }
    };
    const resume = () => { blocked = false; pump(); };
    // Subscribe before reading the latest persisted sequence; commits cannot fall in a gap.
    unsubscribe = this.service.subscribe(user, id, () => {
      // Coalesce adjacent tokens, rather than force a network/Markdown update per token.
      if (!closed && !blocked && !deliveryTimer) deliveryTimer = setTimeout(() => {
        deliveryTimer = undefined; pump();
      }, 40);
    });
    res.on("drain", resume);
    req.once("aborted", close);
    res.once("close", close);
    heartbeat = setInterval(() => {
      pump();
      if (!closed && !blocked) blocked = !res.write(": heartbeat\n\n");
    }, 15000);
    pump();
  }
}
