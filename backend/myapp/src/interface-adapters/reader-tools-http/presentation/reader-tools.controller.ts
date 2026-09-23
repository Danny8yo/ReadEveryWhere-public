import { Body, Controller, Get, Inject, Param, ParseIntPipe, Post, Query, Req, UseInterceptors } from "@nestjs/common";
import type { Request } from "express";
import { AllowAiAccess } from "../../../modules/identity/public";
import {
  BOOK_CONTENT_ACCESS_PORT,
  type BookContentAccessPort,
  type EpubBookLocatorV1,
} from "../../../modules/intelligent-library/public";
import { GetBookMetadataUseCase } from "../application/get-book-metadata.use-case";
import { ListBookAnnotationsUseCase } from "../application/list-book-annotations.use-case";
import { SearchLibraryUseCase } from "../application/search-library.use-case";
import {
  BookAnnotationsDto,
  BookReadDto,
  BookReadFromTocDto,
  BookSemanticSearchDto,
  BookTextSearchDto,
  BookTocDto,
  LibrarySearchDto,
} from "./dto/reader-tools.dto";
import { ReaderToolErrorInterceptor } from "./reader-tool-error.interceptor";

@Controller("api/v1/reader-tools")
@AllowAiAccess("books:read")
@UseInterceptors(ReaderToolErrorInterceptor)
export class ReaderToolsController {
  constructor(
    private readonly searchLibraryUseCase: SearchLibraryUseCase,
    private readonly getBookMetadataUseCase: GetBookMetadataUseCase,
    @Inject(BOOK_CONTENT_ACCESS_PORT)
    private readonly bookContent: BookContentAccessPort,
    private readonly listBookAnnotationsUseCase: ListBookAnnotationsUseCase,
  ) {}

  @Get("library")
  searchLibrary(@Req() req: Request, @Query() query: LibrarySearchDto) {
    return this.searchLibraryUseCase.execute(req.user!.userId, query);
  }

  @Get("books/:bookId/metadata")
  getMetadata(@Req() req: Request, @Param("bookId", ParseIntPipe) bookId: number) {
    return this.getBookMetadataUseCase.execute(req.user!.userId, bookId);
  }

  @Post("books/:bookId/toc")
  getToc(
    @Req() req: Request,
    @Param("bookId", ParseIntPipe) bookId: number,
    @Body() dto: BookTocDto,
  ) {
    return this.bookContent.getToc(req.user!.userId, bookId, dto);
  }

  @Post("read")
  read(@Req() req: Request, @Body() dto: BookReadDto) {
    return this.bookContent.read(req.user!.userId, {
      locator: dto.locator as EpubBookLocatorV1,
      endLocator: dto.endLocator as EpubBookLocatorV1 | undefined,
      direction: dto.direction,
      maxChars: dto.maxChars,
    });
  }

  @Post("books/:bookId/read-from-toc")
  readFromToc(
    @Req() req: Request,
    @Param("bookId", ParseIntPipe) bookId: number,
    @Body() dto: BookReadFromTocDto,
  ) {
    return this.bookContent.readFromToc(req.user!.userId, bookId, dto);
  }

  @Post("books/:bookId/search-text")
  searchText(
    @Req() req: Request,
    @Param("bookId", ParseIntPipe) bookId: number,
    @Body() dto: BookTextSearchDto,
  ) {
    return this.bookContent.searchText(req.user!.userId, bookId, dto);
  }

  @Post("books/:bookId/search-semantic")
  searchSemantic(
    @Req() req: Request,
    @Param("bookId", ParseIntPipe) bookId: number,
    @Body() _dto: BookSemanticSearchDto,
  ) {
    return this.bookContent.searchSemantically(req.user!.userId, bookId);
  }

  @Post("books/:bookId/annotations")
  @AllowAiAccess("books:read", "annotations:read")
  listAnnotations(
    @Req() req: Request,
    @Param("bookId", ParseIntPipe) bookId: number,
    @Body() dto: BookAnnotationsDto,
  ) {
    return this.listBookAnnotationsUseCase.execute(req.user!.userId, bookId, dto);
  }
}
