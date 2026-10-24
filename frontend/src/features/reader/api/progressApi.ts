import type {ProgressLocationType,ReadingProgressRecord,UpsertProgressParams} from '../model/progress';
import { request } from "../../../shared/web/apiClient";







/** 上报当前阅读位置；服务端按设备序列拒绝同一设备的过期请求。 */
export const upsertProgress = (params: UpsertProgressParams): Promise<ReadingProgressRecord> => {
  return request<ReadingProgressRecord>("/api/v1/progress", {
    method: "PUT",
    body: JSON.stringify(params),
  });
};

/** 取某本书的当前进度（无则 null）。 */
export const getProgress = (bookId: number): Promise<ReadingProgressRecord | null> => {
  return request<ReadingProgressRecord | null>("/api/v1/progress", {
    method: "GET",
    params: { bookId },
  });
};
