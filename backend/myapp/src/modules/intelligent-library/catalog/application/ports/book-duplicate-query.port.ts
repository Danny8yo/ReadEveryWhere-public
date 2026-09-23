export interface DuplicateBookProjection {
  id: number;
  title: string;
}

export interface BookDuplicateQueryPort {
  findBySource(ownerId: number, platform: string, sourceBookId: string): DuplicateBookProjection | null;
  findPotentialDuplicate(
    ownerId: number,
    titleNormalized: string,
    authorsText: string,
    publishYear: number | null,
    editionTag: string | null,
  ): DuplicateBookProjection | null;
  findByChecksum(ownerId: number, checksum: string): DuplicateBookProjection | null;
}

export const BOOK_DUPLICATE_QUERY_PORT = Symbol("INTELLIGENT_LIBRARY_BOOK_DUPLICATE_QUERY_PORT");
