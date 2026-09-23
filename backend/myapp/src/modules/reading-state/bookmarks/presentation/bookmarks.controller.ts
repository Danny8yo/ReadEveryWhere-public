import { Body, Controller, Delete, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { AppException } from "../../../../platform/http/app-exception";
import { throwReadingStateHttpError } from "../../presentation/http/reading-state-error.mapper";
import type { BookmarkLocationType } from "../domain/bookmark.types";
import { CreateBookmarkUseCase } from "../application/use-cases/create-bookmark.use-case";
import { ListBookmarksUseCase } from "../application/use-cases/list-bookmarks.use-case";
import { DeleteBookmarkUseCase } from "../application/use-cases/delete-bookmark.use-case";
import { CreateBookmarkDto } from "./dto/create-bookmark.dto";
import { ListBookmarksDto } from "./dto/list-bookmarks.dto";
import { DeleteBookmarkParamDto } from "./dto/delete-bookmark.dto";

@Controller("api/v1/bookmarks")
export class BookmarksController {
  constructor(
    private readonly createBookmarkUseCase: CreateBookmarkUseCase,
    private readonly listBookmarksUseCase: ListBookmarksUseCase,
    private readonly deleteBookmarkUseCase: DeleteBookmarkUseCase,
  ) {}

  @Get()
  list(@Req() req: Request, @Query() query: ListBookmarksDto) {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized();
    return this.listBookmarksUseCase.execute(userId, query.bookId);
  }

  @Post()
  create(@Req() req: Request, @Body() dto: CreateBookmarkDto) {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized();
    try {
      return this.createBookmarkUseCase.execute(userId, {
        bookId: dto.bookId,
        bookHash: dto.bookHash ?? "",
        location: dto.location,
        locationType: (dto.locationType ?? "epubcfi") as BookmarkLocationType,
        fraction: dto.fraction,
        chapterLabel: dto.chapterLabel ?? null,
      });
    } catch (error) {
      throwReadingStateHttpError(error);
    }
  }

  @Delete(":id")
  remove(@Req() req: Request, @Param() params: DeleteBookmarkParamDto) {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized();
    try {
      this.deleteBookmarkUseCase.execute(userId, params.id);
      return { deleted: true };
    } catch (error) {
      throwReadingStateHttpError(error);
    }
  }
}
