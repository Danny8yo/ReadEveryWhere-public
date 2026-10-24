export {
  BOOK_OWNERSHIP_PORT,
  type BookOwnershipPort,
  type BookOwnershipQuery,
} from "./book-ownership.port";
export {
  LIBRARY_QUERY_PORT,
  type LibraryQueryBookProjection,
  type LibraryQueryPage,
  type LibraryQueryPort,
} from "./library-query.port";
export {
  ATTACH_BOOK_FILE_PORT,
  BOOK_FILE_STATUS_QUERY_PORT,
  type AttachBookFileCommand,
  type AttachBookFilePort,
  type AttachedBookFileProjection,
  type DetachBookFileCommand,
  type BookFileStatusQueryPort,
  type ExistingBookFileProjection,
  type ExistingBookFileQuery,
} from "./book-file-acquisition.port";
export {
  BOOK_SOURCE_REFERENCE_QUERY_PORT,
  type BookSourceReferenceProjection,
  type BookSourceReferenceQuery,
  type BookSourceReferenceQueryPort,
} from "./book-source-reference-query.port";
export { IntelligentLibraryModule } from "../intelligent-library.module";
export {
  DOUBAN_RATING_SOURCE_PORT,
  AI_METADATA_SOURCE_PORT,
  METADATA_SOURCE_CONTEXT_PORT,
  METADATA_SOURCE_PORTS,
  type DoubanRatingCandidate,
  type DoubanRatingSourcePort,
  type MetadataSourceContextPort,
  type MetadataSourcePort,
  type ScrapedBook,
} from "./metadata-source.port";
export {
  BOOK_CONTENT_ACCESS_PORT,
  type BookContentAccessPort,
} from "./book-content-access.port";
export {
  BOOK_METADATA_CONTENT_PORT,
  type BookMetadataContentPort,
  type BookMetadataContentInspection,
  type BookMetadataProjection,
  type MetadataSection,
  type MetadataSectionDescriptor,
} from "./book-metadata-content.port";
export { type MetadataSourceRequest } from "./metadata-source.port";
export {
  contentRevisionKey,
  decodeCursor,
  encodeCursor,
  makeCitation,
  makeLocator,
  requireOwnedBook,
  revisionsEqual,
  structureAt,
} from "../book-content/application/reader-tool.utils";
export {
  type ReaderFocusHint,
  type ResolvedReaderFocus,
} from "../book-content/application/use-cases/resolve-reader-focus.use-case";
export {
  EBOOK_FORMATS,
  EBOOK_FORMAT_MIME_TYPES,
  ebookFormatFromMimeType,
  type EbookFormat,
} from "./ebook-format";
export {
  type BookDocument,
  type ContentRevision,
  type DocumentSection,
  type DocumentTocNode,
  type EpubBookLocatorV1,
} from "../book-content/domain/book-document.types";
export {
  ReaderToolException,
  type ReaderToolErrorCode,
  type ReaderToolErrorDetails,
} from "./reader-tool-error";

export * from "./current-book-artifact-fence.port";
export * from "./book-selection.port";

export * from './book-retrieval.port';

export { LIBRARY_PROJECTION_CHANGE_PORT, type LibraryProjectionChangePort, type LibraryVersion } from "./library-projection-change.port";
