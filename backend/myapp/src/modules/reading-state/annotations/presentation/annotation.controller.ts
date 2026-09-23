import { ANNOTATION_SELECTION_COMMAND_PORT, type AnnotationSelectionCommandPort } from "../../public/annotation-selection-command.port";
import { Inject, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { AppException } from "../../../../platform/http/app-exception";
import { throwReadingStateHttpError } from "../../presentation/http/reading-state-error.mapper";
import type { AnnotationType, LocationType } from "../domain/annotation.types";
import { CreateAnnotationUseCase } from "../application/use-cases/create-annotation.use-case";
import { UpdateAnnotationUseCase } from "../application/use-cases/update-annotation.use-case";
import { ListAnnotationsUseCase } from "../application/use-cases/list-annotations.use-case";
import { DeleteAnnotationUseCase } from "../application/use-cases/delete-annotation.use-case";
import { CreateAnnotationDto } from "./dto/create-annotation.dto";
import { UpdateAnnotationDto } from "./dto/update-annotation.dto";
import { ListAnnotationsDto } from "./dto/list-annotations.dto";
import { DeleteAnnotationDto } from "./dto/update-annotation.dto";

@Controller("api/v1/annotations")
export class AnnotationController {
  constructor(
    private readonly createAnnotationUseCase: CreateAnnotationUseCase,
    private readonly updateAnnotationUseCase: UpdateAnnotationUseCase,
    private readonly listAnnotationsUseCase: ListAnnotationsUseCase,
    private readonly deleteAnnotationUseCase: DeleteAnnotationUseCase,
    @Inject(ANNOTATION_SELECTION_COMMAND_PORT) private readonly selectionCommands: AnnotationSelectionCommandPort,
  ) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateAnnotationDto) {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized();
    try {
      return this.createAnnotationUseCase.execute(userId, {
        bookId: dto.bookId,
        bookHash: dto.bookHash,
        annotationType: dto.annotationType as AnnotationType,
        color: dto.color,
        location: dto.location,
        locationType: (dto.locationType ?? "epubcfi") as LocationType,
        textContent: dto.textContent,
        contextBefore: dto.contextBefore ?? null,
        contextAfter: dto.contextAfter ?? null,
        chapterLabel: dto.chapterLabel ?? null,
        sectionIndex: dto.sectionIndex ?? null,
        textPositionStart: dto.textPositionStart ?? null,
        textPositionEnd: dto.textPositionEnd ?? null,
        sortKey: dto.sortKey ?? null,
        note: dto.note ?? null,
      });
    } catch (error) {
      throwReadingStateHttpError(error);
    }
  }

  @Patch(":id")
  update(@Req() req: Request, @Param("id") id: string, @Body() dto: UpdateAnnotationDto) {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized();
    try {
      return this.updateAnnotationUseCase.execute(userId, id, dto);
    } catch (error) {
      throwReadingStateHttpError(error);
    }
  }

  @Get("commands/:commandId")
  command(@Req() req: Request, @Param("commandId") commandId: string) {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized();
    return this.selectionCommands.findReceipt(userId, commandId);
  }

  @Get()
  list(@Req() req: Request, @Query() query: ListAnnotationsDto) {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized();
    return this.listAnnotationsUseCase.execute(userId, {
      userId,
      bookId: query.bookId,
      type: query.type as any,
      hasNote: query.hasNote,
    });
  }

  @Delete(":id")
  remove(@Req() req: Request, @Param("id") id: string, @Query() query: DeleteAnnotationDto) {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized();
    try {
      this.deleteAnnotationUseCase.execute(userId, id, query.revision);
      return { deleted: true };
    } catch (error) {
      throwReadingStateHttpError(error);
    }
  }

}
