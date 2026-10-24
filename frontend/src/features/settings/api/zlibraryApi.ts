import type { ZlibraryConfig, SaveZlibraryConfigPayload, ImportZlibraryCookiesPayload, ZlibraryProbeResult, ZlibraryDiscoveryResult } from '../model/zlibrary';
import { request } from '../../../shared/web/apiClient';
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
    probe: (baseUrl: string): Promise<ZlibraryProbeResult> => request<ZlibraryProbeResult>('/api/v1/user/zlibrary-config/probe', {
        method: 'POST',
        body: JSON.stringify({ baseUrl }),
    }),
    discoverDomains: (baseUrl: string): Promise<ZlibraryDiscoveryResult> => request<ZlibraryDiscoveryResult>('/api/v1/user/zlibrary-config/discover-domains', { method: 'POST', body: JSON.stringify({ baseUrl }) }),
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
