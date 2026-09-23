import type { DoubanConfig } from '../model/douban';
import { request } from '../../../services/apiClient';
export const doubanApi = {
    getConfig: (): Promise<DoubanConfig> => {
        return request<DoubanConfig>('/api/v1/metadata/douban-config');
    },
    updateConfig: (payload: Partial<DoubanConfig>): Promise<DoubanConfig> => {
        return request<DoubanConfig>('/api/v1/metadata/douban-config', {
            method: 'PATCH',
            body: JSON.stringify(payload),
        });
    },
};
