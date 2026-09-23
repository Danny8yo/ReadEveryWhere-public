import { Module } from "@nestjs/common";
import {
  BOOK_CONTENT_ACCESS_PORT,
  IntelligentLibraryModule,
  LIBRARY_QUERY_PORT,
  type BookContentAccessPort,
  type LibraryQueryPort,
} from "../../modules/intelligent-library/public";
import {
  ANNOTATION_QUERY_PORT,
  type AnnotationQueryPort,
} from "../../modules/reading-state/public";
import { ReadingStateModule } from "../../modules/reading-state/reading-state.module";
import { GetBookMetadataUseCase } from "./application/get-book-metadata.use-case";
import { ListBookAnnotationsUseCase } from "./application/list-book-annotations.use-case";
import { SearchLibraryUseCase } from "./application/search-library.use-case";
import { ReaderToolsController } from "./presentation/reader-tools.controller";
import { ReaderToolErrorInterceptor } from "./presentation/reader-tool-error.interceptor";

@Module({
  imports: [IntelligentLibraryModule, ReadingStateModule],
  controllers: [ReaderToolsController],
  providers: [
    ReaderToolErrorInterceptor,
    {
      provide: GetBookMetadataUseCase,
      inject: [LIBRARY_QUERY_PORT, BOOK_CONTENT_ACCESS_PORT, ANNOTATION_QUERY_PORT],
      useFactory: (
        library: LibraryQueryPort,
        bookContent: BookContentAccessPort,
        annotations: AnnotationQueryPort,
      ) => new GetBookMetadataUseCase(library, bookContent, annotations),
    },
    {
      provide: ListBookAnnotationsUseCase,
      inject: [LIBRARY_QUERY_PORT, BOOK_CONTENT_ACCESS_PORT, ANNOTATION_QUERY_PORT],
      useFactory: (
        library: LibraryQueryPort,
        bookContent: BookContentAccessPort,
        annotations: AnnotationQueryPort,
      ) => new ListBookAnnotationsUseCase(library, bookContent, annotations),
    },
    {
      provide: SearchLibraryUseCase,
      inject: [LIBRARY_QUERY_PORT],
      useFactory: (library: LibraryQueryPort) => new SearchLibraryUseCase(library),
    },
  ],
  exports: [GetBookMetadataUseCase, ListBookAnnotationsUseCase],
})
export class ReaderToolsHttpModule {}
