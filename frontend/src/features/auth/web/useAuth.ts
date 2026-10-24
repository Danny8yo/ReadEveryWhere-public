import { ref, computed, reactive, toRefs } from 'vue';
import { createAuthenticationState, createAuthenticationController } from '../domain/authentication';
import { loginRemote, registerRemote, resetPasswordApi, logoutApi, getSession } from '../api/authApi';
import type { AuthUser, AuthSessionData } from '../model/auth';
import { clearStoredAuth, saveAuthSession, getSessionVersion, getBaseUrl, SESSION_EVENT_KEY } from '../../../shared/web/apiClient';
import { clearBookFileCacheForUser } from '../../reader/web/bookFileCache';
import { errorMessage } from '../../../shared/domain/errors';
// Only the server decides whether a session is authenticated. No credentials are
// persisted in JavaScript storage; network failures preserve the current user.
const user = ref<AuthUser | null>(null);
const sessionBackend = ref('');
const sessionGeneration = ref<string|null>(null);
const sessionKey = computed(() => JSON.stringify([sessionBackend.value, user.value?.userId ?? null, sessionGeneration.value]));
const sessionStatus = ref<'checking' | 'ready' | 'unavailable'>('checking');
const sessionError = ref<string | null>(null);
let initialized = false;
let checkGeneration = 0;
let verifiedSessionVersion: string | null = null;
const applySession = (session: AuthSessionData) => {
    const backend = getBaseUrl();
    if (user.value && (user.value.userId !== session.user.userId || sessionBackend.value !== backend)) window.dispatchEvent(new CustomEvent('auth:session-cleared'));
    verifiedSessionVersion = getSessionVersion();
    sessionGeneration.value = verifiedSessionVersion;
    sessionBackend.value = backend;
    user.value = session.user;
    sessionStatus.value = 'ready';
    sessionError.value = null;
};
async function checkSession(blockUntilVerified = false) {
    const generation = ++checkGeneration;
    const version = getSessionVersion();
    const backend = getBaseUrl();
    // Background checks must not unmount an already visible login form.
    // Block only initial/retry verification or a possible authenticated-account switch.
    const blocking = sessionStatus.value !== 'ready' || (blockUntilVerified && user.value !== null);
    if (blocking) sessionStatus.value = 'checking';
    sessionError.value = null;
    try {
        const session = await getSession();
        if (generation === checkGeneration && version === getSessionVersion() && backend === getBaseUrl()) {
            const identityChanged = user.value !== null && (user.value.userId !== session.user.userId || sessionBackend.value !== backend);
            // A focus/online check can discover a cookie changed by a different
            // origin (for example another port). Advance the shared version so
            // responses sent under the old identity cannot clear the new one.
            // A storage-triggered check already has a new version: do not echo it.
            if (identityChanged && version === verifiedSessionVersion) saveAuthSession(session);
            else applySession(session);
        }
    } catch (cause) {
        if (generation !== checkGeneration || version !== getSessionVersion() || backend !== getBaseUrl()) return;
        sessionError.value = `暂时无法确认登录状态：${errorMessage(cause)}`;
        if (blocking) sessionStatus.value = 'unavailable';
    }
}
function initializeSession() {
    if (initialized) return;
    initialized = true;
    window.addEventListener('auth:session-changed', (event) => {
        ++checkGeneration;
        applySession((event as CustomEvent<AuthSessionData>).detail);
    });
    window.addEventListener('auth:session-cleared', (event) => {
        ++checkGeneration;
        const previousUserId = user.value?.userId;
        user.value = null;
        sessionStatus.value = 'ready';
        sessionError.value = null;
        if (previousUserId && !(event as CustomEvent<{ preserveCache?: boolean }>).detail?.preserveCache) void clearBookFileCacheForUser(previousUserId);
    });
    window.addEventListener('storage', event => {
        if (event.key !== SESSION_EVENT_KEY || event.newValue !== getSessionVersion()) return;
        if (event.newValue && JSON.parse(event.newValue).kind === 'cleared') {
            window.dispatchEvent(new CustomEvent('auth:session-cleared'));
        } else {
            // Hide the old account while verifying a potentially different cookie.
            void checkSession(true);
        }
    });
    window.addEventListener('online', () => { void checkSession(); });
    window.addEventListener('focus', () => { void checkSession(); });
    void checkSession();
}
export function useAuth() {
    initializeSession();
    const state = reactive(createAuthenticationState());
    const controller = createAuthenticationController(state, {
        login: loginRemote, register: registerRemote, resetPassword: resetPasswordApi, logout: logoutApi,
        clearSession: clearStoredAuth, saveSession: saveAuthSession,
    });
    return { user, sessionKey, sessionStatus, sessionError, checkSession: () => checkSession(), showLogin: () => { window.dispatchEvent(new CustomEvent('auth:session-cleared', { detail: { preserveCache: true } })); }, ...toRefs(state), ...controller, isAuthenticated: computed(() => user.value !== null) };
}
