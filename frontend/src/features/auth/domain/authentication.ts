import type { AuthResponse } from '../model/auth';
import { errorMessage } from '../../../shared/domain/errors';
export const createAuthenticationState = () => ({ loading: false, error: null as string | null });
export interface AuthenticationGateway {
    login(email: string, password: string): Promise<AuthResponse>;
    register(email: string, password: string, confirmPassword: string): Promise<AuthResponse>;
    resetPassword(currentPassword: string, password: string, confirmPassword: string): Promise<AuthResponse>;
    logout(): Promise<unknown>;
    saveSession(session: AuthResponse): void;
    clearSession(): void;
}
/** 命令状态属于表单实例；认证会话的保存与通知由宿主实现。 */
export function createAuthenticationController(state: ReturnType<typeof createAuthenticationState>, api: AuthenticationGateway) {
    async function authenticate(request: () => Promise<AuthResponse>) {
        if (state.loading)
            return false;
        state.loading = true;
        state.error = null;
        try {
            api.saveSession(await request());
            return true;
        }
        catch (cause) {
            state.error = errorMessage(cause);
            return false;
        }
        finally {
            state.loading = false;
        }
    }
    const login = (email: string, password: string) => authenticate(() => api.login(email, password));
    const register = (email: string, password: string, confirmPassword: string) => authenticate(() => api.register(email, password, confirmPassword));
    const resetPassword = (current: string, password: string, confirmPassword: string) => authenticate(() => api.resetPassword(current, password, confirmPassword));
    async function logout() {
        try {
            await api.logout();
            api.clearSession();
            return true;
        }
        catch (cause) {
            state.error = errorMessage(cause);
            return false;
        }
    }
    return { login, register, resetPassword, logout, clearAuth: api.clearSession };
}
