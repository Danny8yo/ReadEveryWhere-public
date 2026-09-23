import { LibrarySyncState } from "../../../library-sync/library-sync-state";
import { Body, Controller, Delete, Get, Header, Param, ParseFilePipe, ParseIntPipe, Patch, Post, Query, Req, Res, UploadedFile, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { AppException } from "../../../../../platform/http/app-exception";
import { Public } from "../../../../identity/public";
import { BatchDeleteBooksUseCase } from "../../../catalog/application/use-cases/batch-delete-books.use-case";
import { CreateBookFileAccessUseCase } from "../../../catalog/application/use-cases/create-book-file-access.use-case";
import { AddBookFromSearchUseCase } from "../../../catalog/application/use-cases/add-book-from-search.use-case";
import { CreateBookUseCase } from "../../../catalog/application/use-cases/create-book.use-case";
import { DeleteBookUseCase } from "../../../catalog/application/use-cases/delete-book.use-case";
import { ImportBookUseCase } from "../../../catalog/application/use-cases/import-book.use-case";
import { UpdateBookUseCase } from "../../../catalog/application/use-cases/update-book.use-case";
import { GetBookReadingProfileUseCase } from "../../../catalog/application/use-cases/get-book-reading-profile.use-case";
import { EditBookReadingProfileUseCase } from "../../../catalog/application/use-cases/edit-book-reading-profile.use-case";
import { ClearBookReadingProfileUseCase } from "../../../catalog/application/use-cases/clear-book-reading-profile.use-case";
import { CatalogError } from "../../../catalog/domain/catalog.error";
import { EbookFileValidator } from "../../../catalog/infrastructure/ebook-format.validator";
import { ListLibraryBooksUseCase } from "../../application/list-library-books.use-case";
import { GetLibraryBookUseCase } from "../../application/get-library-book.use-case";
import { AddFromSearchDto } from "./dto/add-from-search.dto";
import { BatchDeleteBooksDto } from "./dto/batch-delete-books.dto";
import { CreateBookDto } from "./dto/create-book.dto";
import { ImportBookDto } from "./dto/import-book.dto";
import { ListLibraryBooksDto } from "./dto/list-library-books.dto";
import { UpdateBookDto } from "./dto/update-book.dto";
import { EditBookReadingProfileDto } from "./dto/edit-book-reading-profile.dto";
import { BatchImportBookResult } from "../../../catalog/application/catalog.types";
import { StreamBookFileHttpService } from "./stream-book-file-http.service";
import { toCatalogHttpError, throwCatalogHttpError } from "./catalog-error.mapper";
import { IMPORT_CAPABILITIES } from "./import-upload.config";

const IMPORT_MAX_FILE_SIZE_BYTES = IMPORT_CAPABILITIES.maxFileSizeBytes;

@Controller("api/v1/library/books")
export class LibraryController {
  constructor(
    private readonly sync: LibrarySyncState,
    private readonly listLibraryBooksUseCase: ListLibraryBooksUseCase,
    private readonly getLibraryBookUseCase: GetLibraryBookUseCase,
    private readonly createBookUseCase: CreateBookUseCase,
    private readonly addBookFromSearchUseCase: AddBookFromSearchUseCase,
    private readonly updateBookUseCase: UpdateBookUseCase,
    private readonly deleteBookUseCase: DeleteBookUseCase,
    private readonly batchDeleteBooksUseCase: BatchDeleteBooksUseCase,
    private readonly createBookFileAccessUseCase: CreateBookFileAccessUseCase,
    private readonly streamBookFileUseCase: StreamBookFileHttpService,
    private readonly importBookUseCase: ImportBookUseCase,
    private readonly getBookReadingProfileUseCase: GetBookReadingProfileUseCase,
    private readonly editBookReadingProfileUseCase: EditBookReadingProfileUseCase,
    private readonly clearBookReadingProfileUseCase: ClearBookReadingProfileUseCase,
  ) {}

  @Get()
  listBooks(@Req() req: Request, @Query() query: ListLibraryBooksDto) {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }

    const page = this.listLibraryBooksUseCase.execute(userId, query);
    return { ...page, libraryVersion: this.sync.version(userId), progressSequence: this.sync.watermark(userId) };
  }

  @Get("import-capabilities")
  @Header("Cache-Control", "no-store")
  getImportCapabilities() {
    return IMPORT_CAPABILITIES;
  }

  @Get(":id")
  getBook(@Req() req: Request, @Param("id", ParseIntPipe) id: number) {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized("Missing user context");
    try {
      return this.getLibraryBookUseCase.execute(userId, id);
    } catch (error) {
      throwCatalogHttpError(error);
    }
  }

  @Get(":id/reading-profile")
  getReadingProfile(@Req() req: Request, @Param("id", ParseIntPipe) id: number) {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized("Missing user context");
    try {
      return toReadingProfileDto(this.getBookReadingProfileUseCase.execute(userId, id));
    } catch (error) {
      throwCatalogHttpError(error);
    }
  }

  @Patch(":id/reading-profile")
  editReadingProfile(
    @Req() req: Request,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: EditBookReadingProfileDto,
  ) {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized("Missing user context");
    try {
      return toReadingProfileDto(this.editBookReadingProfileUseCase.execute(userId, id, dto));
    } catch (error) {
      throwCatalogHttpError(error);
    }
  }

  @Delete(":id/reading-profile")
  clearReadingProfile(@Req() req: Request, @Param("id", ParseIntPipe) id: number) {
    const userId = req.user?.userId;
    if (!userId) throw AppException.unauthorized("Missing user context");
    try {
      return toReadingProfileDto(this.clearBookReadingProfileUseCase.execute(userId, id));
    } catch (error) {
      throwCatalogHttpError(error);
    }
  }

  @Post("import")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: IMPORT_MAX_FILE_SIZE_BYTES } }))
  async importBook(
    @Req() req: Request,
    @UploadedFile(new ParseFilePipe({ validators: [new EbookFileValidator({})], fileIsRequired: true }))
    file: Express.Multer.File,
    @Body() dto: ImportBookDto,
  ) {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }

    try {
      return await this.importBookUseCase.execute({
        userId,
        file: {
          originalname: Buffer.from(file.originalname, 'latin1').toString('utf8'),
          mimetype: file.mimetype,
          buffer: file.buffer,
          size: file.size,
        },
        title: dto.title,
        authors: dto.authors,
        isbn: dto.isbn,
        coverUrl: dto.coverUrl,
        conflictPolicy: dto.conflictPolicy ?? "rename",
      });
    } catch (error) {
      throwCatalogHttpError(error);
    }
  }

  @Post("import/batch")
  // 批量上限 20：multer 默认内存存储，单次文件数 × 单文件上限决定峰值内存占用
  @UseInterceptors(FilesInterceptor("files", 20, { limits: { fileSize: IMPORT_MAX_FILE_SIZE_BYTES } }))
  async importBooksBatch(
    @Req() req: Request,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: ImportBookDto,
  ): Promise<BatchImportBookResult> {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }
    if (!files || files.length === 0) {
      throw AppException.validation("files", "At least one file is required");
    }

    // 顺序处理而不是并发：单个 PDF 落库时要跑 qpdf 重建页树，20 个文件同时跑会把
    // 内存峰值放大二十倍。
    const items: BatchImportBookResult["items"] = [];
    for (const [index, file] of files.entries()) {
      const originalFileName = Buffer.from(file.originalname, "latin1").toString("utf8");
      try {
        const result = await this.importBookUseCase.execute({
          userId,
          file: {
            originalname: originalFileName,
            mimetype: file.mimetype,
            buffer: file.buffer,
            size: file.size,
          },
          conflictPolicy: dto.conflictPolicy ?? "rename",
        });
        items.push({
          index,
          originalFileName,
          importStatus: "imported" as const,
          metadataStatus: result.metadataStatus,
          scrapeQuery: result.scrapeQuery,
          scrapeQueryStrategy: result.scrapeQueryStrategy,
          storedFileName: result.storedFileName,
          book: result.book,
        });
      } catch (error) {
        const mapped = error instanceof CatalogError ? toCatalogHttpError(error) : error;
        const message = mapped instanceof Error ? mapped.message : "导入失败";
        items.push({
          index,
          originalFileName,
          importStatus: "failed" as const,
          metadataStatus: "failed" as const,
          error: message,
        });
      }
    }

    return {
      items,
      importedCount: items.filter((item) => item.importStatus === "imported").length,
      failedCount: items.filter((item) => item.importStatus === "failed").length,
    };
  }

  @Post()
  createBook(@Req() req: Request, @Body() dto: CreateBookDto) {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }

    try {
      return this.createBookUseCase.execute(userId, dto);
    } catch (error) {
      throwCatalogHttpError(error);
    }
  }

  @Post("from-search")
  addFromSearch(@Req() req: Request, @Body() dto: AddFromSearchDto) {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }

    try {
      return this.addBookFromSearchUseCase.execute(userId, dto);
    } catch (error) {
      throwCatalogHttpError(error);
    }
  }

  @Patch(":id")
  updateBook(
    @Req() req: Request,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateBookDto,
  ) {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }

    try {
      return this.updateBookUseCase.execute(userId, id, dto);
    } catch (error) {
      throwCatalogHttpError(error);
    }
  }

  @Delete(":id")
  deleteBook(@Req() req: Request, @Param("id", ParseIntPipe) id: number) {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }

    return this.deleteBookUseCase.execute(userId, id);
  }

  @Post("batch-delete")
  batchDeleteBooks(@Req() req: Request, @Body() dto: BatchDeleteBooksDto) {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }

    return this.batchDeleteBooksUseCase.execute(userId, dto.ids);
  }

  @Post(":id/file-access")
  createBookFileAccess(@Req() req: Request, @Param("id", ParseIntPipe) id: number) {
    const userId = req.user?.userId;
    if (!userId) {
      throw AppException.unauthorized("Missing user context");
    }

    try {
      return this.createBookFileAccessUseCase.execute(userId, id);
    } catch (error) {
      throwCatalogHttpError(error);
    }
  }

  @Public()
  @SkipThrottle()
  @Get(":id/file")
  async streamBookFileWithToken(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id", ParseIntPipe) id: number,
  ) {
    try {
      const signedToken = typeof req.query.token === "string" ? req.query.token : null;
      if (!signedToken) {
        throw AppException.unauthorized("Missing user context");
      }
      const payload = this.createBookFileAccessUseCase.verify(signedToken);
      if (payload.bookId !== id) {
        throw AppException.unauthorized("Invalid file access token");
      }
      await this.streamBookFileUseCase.execute(payload.userId, id, req, res);
    } catch (error: any) {
      if (!res.headersSent) {
        const httpError = error instanceof CatalogError ? toCatalogHttpError(error) : error;
        if (httpError instanceof AppException) {
          res.status(httpError.status).json({
            code: httpError.code,
            message: httpError.message,
            details: httpError.details ?? null,
          });
          return;
        }
        res.status(500).json({ code: 500, message: error.message || "Internal server error" });
      }
    }
  }

  @SkipThrottle()
  @Get(":id/stream")
  async streamBookFile(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id", ParseIntPipe) id: number,
  ) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw AppException.unauthorized("Missing user context");
      }
      await this.streamBookFileUseCase.execute(userId, id, req, res);
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ code: 500, message: error.message || "Internal server error" });
      }
    }
  }
}

function toReadingProfileDto(profile: ReturnType<GetBookReadingProfileUseCase["execute"]>) {
  return {
    ...profile,
    confidence: {
      kind: profile.confidence?.kind ?? null,
      score: profile.confidence?.kind === "ai-score" ? profile.confidence.score : null,
    },
  };
}
