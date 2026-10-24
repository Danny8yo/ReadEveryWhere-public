export interface ApiRequestOptions extends RequestInit {
  invalidateSession?: boolean;
  params?: Record<string, string | number | readonly (string | number)[]>;
}

const BACKEND_BASE_URL_STORAGE_KEY = 'readEveryWhere.backendBaseUrl';
const AUTH_TOKEN_STORAGE_KEY = 'readEveryWhere.accessToken';
const REFRESH_TOKEN_STORAGE_KEY = 'readEveryWhere.refreshToken';
const USER_INFO_STORAGE_KEY = 'readEveryWhere.user';
// 生产构建默认走同源相对路径（''）：前端与后端由同一个 Caddy 反代托管，
// /api/* 会被转发到后端容器，无需也不应指向 localhost:3000。
// 开发默认仍指向本地后端 3000（配合后端 CORS 白名单）。用户仍可在登录页覆盖。
const DEFAULT_BACKEND_BASE_URL = import.meta.env.PROD ? '' : 'localhost:3000';

interface ApiPayload<T = unknown> {
  code: number;
  message?: string;
  data?: T;
  details?: unknown;
}

const parseApiPayload = async <T>(response: Response): Promise<ApiPayload<T>> => {
  let payload: unknown;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw {
      code: response.status || 500,
      message: response.ok ? '服务响应格式异常' : `服务请求失败（HTTP ${response.status}）`,
      details: {
        reason: 'NON_JSON_RESPONSE',
        status: response.status,
      },
    };
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw {
      code: response.status || 500,
      message: '服务响应格式异常',
      details: {
        reason: 'INVALID_RESPONSE_ENVELOPE',
        status: response.status,
      },
    };
  }

  return payload as ApiPayload<T>;
};

export const getBaseUrl = (): string => {
  const stored = localStorage.getItem(BACKEND_BASE_URL_STORAGE_KEY) ?? DEFAULT_BACKEND_BASE_URL;
  const trimmed = stored.trim().replace(/\/+$/, '');
  // 空 = 同源：返回空串，resolveBackendUrl 会生成相对路径（/api/v1/...）。
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
};

export const resolveBackendUrl = (path: string): string => {
  if (/^https?:\/\//i.test(path)) return path;
  return `${getBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
};

// This marker carries no credentials; it invalidates responses from an older login
// across tabs before their storage event is delivered.
export const SESSION_EVENT_KEY = 'readEveryWhere.sessionEvent';
export const getSessionVersion = () => localStorage.getItem(SESSION_EVENT_KEY);
const publishSession = (kind: 'changed' | 'cleared') => {
  localStorage.setItem(SESSION_EVENT_KEY, JSON.stringify({ kind, id: crypto.getRandomValues(new Uint32Array(4)).join('-') }));
};
export const saveAuthSession = <T>(session: T) => {
  publishSession('changed');
  window.dispatchEvent(new CustomEvent('auth:session-changed', { detail: session }));
};
export const clearStoredAuth = () => {
  publishSession('cleared');
  window.dispatchEvent(new CustomEvent('auth:session-cleared'));
};
// One-time upgrade: never retain the former bearer credentials or trust cached users.
const removeLegacyCredentials = () => {
  for (const key of [AUTH_TOKEN_STORAGE_KEY, REFRESH_TOKEN_STORAGE_KEY, USER_INFO_STORAGE_KEY]) localStorage.removeItem(key);
};

export const fetchWithAuth = async (input: string, options: RequestInit = {}, invalidateSession = true): Promise<Response> => {
  removeLegacyCredentials();
  const version = getSessionVersion();
  const backend = getBaseUrl();
  const response = await fetch(input, { ...options, credentials: 'include' });
  if (response.status === 401 && invalidateSession && version === getSessionVersion() && backend === getBaseUrl()) clearStoredAuth();
  return response;
};

export const request = async <T>(path: string, options: ApiRequestOptions = {}): Promise<T> => {
  const { params, headers, invalidateSession = true, ...rest } = options;
  let url = resolveBackendUrl(path);
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) value.forEach(entry => searchParams.append(key, String(entry)));
      else searchParams.append(key, String(value));
    });
    url += `?${searchParams.toString()}`;
  }
  const fetchHeaders = new Headers(headers);
  fetchHeaders.set('Content-Type', 'application/json');
  const response = await fetchWithAuth(url, { ...rest, headers: fetchHeaders }, invalidateSession);
  const payload = await parseApiPayload<T>(response);
  if (!response.ok || payload.code !== 0) throw payload;
  return payload.data as T;
};

export const requestFormData = async <T>(path: string, body: FormData, method = 'POST'): Promise<T> => {
  const response = await fetchWithAuth(resolveBackendUrl(path), { method, body });
  const payload = await parseApiPayload<T>(response);
  if (!response.ok || payload.code !== 0) throw payload;
  return payload.data as T;
};
