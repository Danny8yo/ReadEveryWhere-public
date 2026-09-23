import type { LibraryBookDto } from './dto';
import type { LibraryBook } from '../model/library';
/** DTO 在 HTTP 边界校验后进入业务层，保留服务器 revision 与 null 语义。 */
export function mapLibraryBook(dto: LibraryBookDto): LibraryBook {
    if (!Number.isSafeInteger(dto.id) || dto.id <= 0 || !Number.isSafeInteger(dto.version) || dto.version < 1 || !Array.isArray(dto.authors))
        throw new Error('无效书籍响应：id/version/authors');
    return { ...dto, authors: [...dto.authors], doubanRating: dto.doubanRating ? { ...dto.doubanRating } : null };
}
