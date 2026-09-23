import type { LibraryBook } from '../model/library';
import type { BookDetailModel } from '../../../shared/model/bookDetail';
import { formatFileSize } from '../../../utils/fileSize';
// Map LibraryBook back to BookDetailModel for the detail modal to work
export const toLibraryDetail = (libBook: LibraryBook): BookDetailModel => {
    return {
        id: `library:${libBook.id}`,
        sourceBookId: libBook.sourceBookId || String(libBook.id),
        sourcePlatform: libBook.sourcePlatform,
        title: libBook.title,
        authors: libBook.authors,
        publisher: libBook.publisher,
        publishYear: libBook.publishYear,
        identifier: libBook.isbn,
        isbn: libBook.isbn,
        language: libBook.language,
        formats: libBook.format ? [libBook.format] : [],
        fileSize: libBook.fileSize,
        fileSizeText: formatFileSize(libBook.fileSize),
        coverUrl: libBook.coverUrl,
        description: libBook.description,
        downloadPath: null,
        detailUrl: libBook.sourceUrl,
        readOnlineUrl: null,
        readOnlineAvailable: false,
        downloadable: true,
        availability: 'available',
        md5: null,
        sha256: null,
        zlibraryInterestScore: null,
        zlibraryQualityScore: null,
        raw: null,
        bookAnalysis: libBook.bookAnalysis ?? null,
        readingProfile: libBook.readingProfile,
        doubanRating: libBook.doubanRating
            ? {
                sourcePlatform: 'douban',
                sourceBookId: libBook.doubanRating.sourceBookId,
                sourceUrl: libBook.doubanRating.sourceUrl,
                title: libBook.doubanRating.title,
                authors: [],
                publisher: null,
                publishYear: null,
                isbn: null,
                rating: libBook.doubanRating.rating,
                ratingCount: libBook.doubanRating.ratingCount,
                fetchedAt: libBook.doubanRating.fetchedAt,
            }
            : null,
    };
};
