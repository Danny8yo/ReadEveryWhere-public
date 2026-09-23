import { AiReadingDomainError, requireNonEmpty } from './domain-error';

export interface BookScopeJSON {
  userId: string;
  bookId: string;
  contentRevision: string;
}

export class BookScope {
  private constructor(
    public readonly userId: string,
    public readonly bookId: string,
    public readonly contentRevision: string,
  ) {}

  static create(value: BookScopeJSON): BookScope {
    requireNonEmpty(value.userId, 'BOOK_SCOPE_INVALID', 'userId');
    requireNonEmpty(value.bookId, 'BOOK_SCOPE_INVALID', 'bookId');
    requireNonEmpty(
      value.contentRevision,
      'BOOK_SCOPE_INVALID',
      'contentRevision',
    );
    return new BookScope(
      value.userId.trim(),
      value.bookId.trim(),
      value.contentRevision.trim(),
    );
  }

  static fromJSON(value: BookScopeJSON): BookScope {
    if (!value || typeof value !== 'object') {
      throw new AiReadingDomainError(
        'BOOK_SCOPE_INVALID',
        'book scope must be an object',
      );
    }
    return BookScope.create(value);
  }

  equals(other: BookScope): boolean {
    return (
      this.userId === other.userId &&
      this.bookId === other.bookId &&
      this.contentRevision === other.contentRevision
    );
  }

  toJSON(): BookScopeJSON {
    return {
      userId: this.userId,
      bookId: this.bookId,
      contentRevision: this.contentRevision,
    };
  }
}
