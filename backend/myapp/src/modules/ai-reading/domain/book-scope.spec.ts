import { BookScope } from './book-scope';

describe('BookScope', () => {
  it('compares the complete trusted user/book/revision boundary', () => {
    const scope = BookScope.create({
      userId: 'user-1',
      bookId: 'book-1',
      contentRevision: 'rev-1',
    });

    expect(scope.equals(BookScope.fromJSON(scope.toJSON()))).toBe(true);
    expect(
      scope.equals(
        BookScope.create({
          userId: 'user-1',
          bookId: 'book-1',
          contentRevision: 'rev-2',
        }),
      ),
    ).toBe(false);
  });

  it.each(['userId', 'bookId', 'contentRevision'] as const)(
    'rejects an empty %s',
    (field) => {
      expect(() =>
        BookScope.create({
          userId: field === 'userId' ? ' ' : 'user-1',
          bookId: field === 'bookId' ? '' : 'book-1',
          contentRevision: field === 'contentRevision' ? '' : 'rev-1',
        }),
      ).toThrow('BOOK_SCOPE_INVALID');
    },
  );
});
