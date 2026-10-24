export interface ZlibraryConfig {
    hasStoredConfig: boolean;
    baseUrl: string | null;
    downloadsToday: number;
    downloadsLimit: number;
    isPremium: boolean;
    lastLoginAt: string | null;
    loginStatus: 'pending' | 'success' | 'failed';
}
export interface ZlibraryProbeResult {
    baseUrl: string;
    category: string;
    status: number | null;
    checkedAt: string;
    diagnostic?: unknown;
}
export interface ZlibraryDomainCandidate extends ZlibraryProbeResult {}
export interface ZlibraryDiscoveryResult {
    source: string;
    discoveredAt: string;
    candidates: ZlibraryDomainCandidate[];
}
export interface SaveZlibraryConfigPayload {
    email: string;
    password: string;
    baseUrl: string;
}
export interface ImportZlibraryCookiesPayload {
    remixUserid: string;
    remixUserkey: string;
    baseUrl: string;
}
