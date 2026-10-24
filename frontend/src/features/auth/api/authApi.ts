import type { AuthResponse, RegistrationStatus } from '../model/auth';
import { request } from '../../../shared/web/apiClient';
export const getRegistrationStatus = (): Promise<RegistrationStatus> => {
    return request<RegistrationStatus>('/api/v1/auth/registration-status', {
        cache: 'no-store',
    });
};
const authenticate = async (path: string, body: unknown): Promise<AuthResponse> => {
    await request<AuthResponse>(path, { method: 'POST', invalidateSession: false, body: JSON.stringify(body) });
    // Verify that the browser accepted and returns the cookie before showing the library.
    try {
        return await request<AuthResponse>('/api/v1/auth/session', { cache: 'no-store', invalidateSession: false });
    } catch (cause) {
        throw new Error('登录会话确认失败，请检查网络与服务器地址，并确认浏览器允许此站点的 Cookie。', { cause });
    }
};
export const loginRemote = (email: string, password: string): Promise<AuthResponse> => {
    return authenticate('/api/v1/auth/login', { email, password });
};
export const registerRemote = (email: string, password: string, confirmPassword: string): Promise<AuthResponse> => {
    return authenticate('/api/v1/auth/register', { email, password, confirmPassword });
};
export const resetPasswordApi = (currentPassword: string, newPassword: string, confirmPassword: string): Promise<AuthResponse> => {
    return authenticate('/api/v1/auth/reset-password', { currentPassword, newPassword, confirmPassword });
};
export const getSession = (): Promise<AuthResponse> => request('/api/v1/auth/session', { cache: 'no-store' });
export const logoutApi = (): Promise<{
    message: string;
}> => {
    return request<{
        message: string;
    }>('/api/v1/auth/logout', {
        method: 'POST',
    });
};
