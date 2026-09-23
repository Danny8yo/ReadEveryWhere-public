import type { SearchAvailability, SearchResultItem } from '../model/book';
import type { SearchApiBook } from './dto';
import { EBOOK_FORMATS, type EbookFormat } from '../../../utils/bookFormat';
const normalizeSearchAuthors = (authors: string[] | null | undefined): string[] => {
    if (!authors || authors.length === 0) {
        return [];
    }
    return authors.map((author) => author.trim()).filter(Boolean);
};
const normalizeSearchFormats = (formats: string[] | null | undefined): EbookFormat[] => {
    if (!formats || formats.length === 0) {
        return [];
    }
    return formats
        .map((format) => format.trim().toLowerCase())
        .filter((format): format is EbookFormat => EBOOK_FORMATS.includes(format as EbookFormat));
};
const normalizeSearchAvailability = (downloadable: boolean | null | undefined, availability: SearchAvailability | string | null | undefined): SearchAvailability => {
    if (availability === 'available' || availability === 'unavailable') {
        return availability;
    }
    return downloadable ? 'available' : 'unavailable';
};
export const mapSearchApiBookToInternal = (raw: SearchApiBook): SearchResultItem => {
    const sourceBookId = String(raw.sourceBookId ?? raw.id);
    return {
        id: `zlibrary:${sourceBookId}`,
        sourceBookId,
        sourcePlatform: 'zlibrary',
        title: raw.title?.trim() ? raw.title : 'Untitled',
        authors: normalizeSearchAuthors(raw.authors),
        publisher: raw.publisher?.trim() ? raw.publisher : null,
        publishYear: raw.publishYear ?? null,
        identifier: raw.identifier?.trim() ? raw.identifier : null,
        language: raw.language?.trim() ? raw.language : null,
        formats: normalizeSearchFormats(raw.formats),
        fileSize: raw.fileSize ?? null,
        fileSizeText: raw.fileSizeText ?? null,
        coverUrl: normalizeCover(raw.coverUrl),
        description: raw.description?.trim() ? raw.description : null,
        downloadPath: raw.downloadPath ?? null,
        detailUrl: raw.sourceUrl ?? null,
        readOnlineUrl: raw.readOnlineUrl ?? null,
        readOnlineAvailable: raw.readOnlineAvailable === true,
        downloadable: raw.downloadable === true,
        availability: normalizeSearchAvailability(raw.downloadable, raw.availability),
        md5: raw.md5 ?? null,
        sha256: raw.sha256 ?? null,
        zlibraryInterestScore: raw.zlibraryInterestScore ?? null,
        zlibraryQualityScore: raw.zlibraryQualityScore ?? null,
        hash: raw.hash ?? null,
        raw: raw.raw ?? null,
    };
};
function normalizeCover(cover: string | null | undefined): string | null {
    if (!cover || cover.includes('cover-not-exists.png')) {
        return null;
    }
    return cover;
}
