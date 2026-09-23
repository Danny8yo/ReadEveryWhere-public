import type { ZlibraryConfig, SaveZlibraryConfigPayload, ImportZlibraryCookiesPayload } from '../model/zlibrary';
import { request } from '../../../services/apiClient';
export const zlibraryApi = {
    getConfig: (): Promise<ZlibraryConfig> => {
        return request<ZlibraryConfig>('/api/v1/user/zlibrary-config');
    },
    saveConfig: (payload: SaveZlibraryConfigPayload): Promise<ZlibraryConfig> => {
        return request<ZlibraryConfig>('/api/v1/user/zlibrary-config', {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
    },
    importCookies: (payload: ImportZlibraryCookiesPayload): Promise<ZlibraryConfig> => {
        return request<ZlibraryConfig>('/api/v1/user/zlibrary-config/cookies', {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
    },
    updateBaseUrl: (baseUrl: string): Promise<{
        baseUrl: string;
    }> => {
        return request<{
            baseUrl: string;
        }>('/api/v1/user/zlibrary-config/base-url', {
            method: 'PATCH',
            body: JSON.stringify({ baseUrl }),
        });
    },
    deleteConfig: (): Promise<{
        deleted: boolean;
    }> => {
        return request<{
            deleted: boolean;
        }>('/api/v1/user/zlibrary-config', {
            method: 'DELETE',
        });
    },
};
