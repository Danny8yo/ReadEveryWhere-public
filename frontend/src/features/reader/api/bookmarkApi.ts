import type {BookmarkLocationType,BookmarkRecord,CreateBookmarkParams} from '../model/bookmark';
import { request } from "../../../services/apiClient";
import type { Bookmark } from "../../../lib/reader/bookmarks";



/** 后端书签记录（字段已由后端 mapRow 转为 camelCase）。 */




/** 取某本书的书签列表（按 created_at 升序）。 */
export const listBookmarks = (bookId: number): Promise<BookmarkRecord[]> => {
  return request<BookmarkRecord[]>("/api/v1/bookmarks", {
    method: "GET",
    params: { bookId },
  });
};

/** 新建书签，返回后端落库记录。 */
export const createBookmark = (params: CreateBookmarkParams): Promise<BookmarkRecord> => {
  return request<BookmarkRecord>("/api/v1/bookmarks", {
    method: "POST",
    body: JSON.stringify(params),
  });
};

/** 删除书签。 */
export const deleteBookmark = (id: number): Promise<{ deleted: boolean }> => {
  return request<{ deleted: boolean }>(`/api/v1/bookmarks/${id}`, {
    method: "DELETE",
  });
};

