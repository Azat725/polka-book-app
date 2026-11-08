import { telegram } from './telegram';
import type { Me, Settings, User } from './types';

export const API_BASE = `${import.meta.env.VITE_API_ORIGIN || ''}/api/v1`;
let accessToken = '';
let refreshToken = '';
let refreshing: Promise<void> | null = null;
const secureKey = 'polka_refresh';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export const getAccessToken = () => accessToken;
export function setSession(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  try {
    telegram()?.SecureStorage?.setItem(secureKey, refresh);
  } catch {
    /* In-memory sessions work on older clients. */
  }
}
export function clearSession() {
  accessToken = '';
  refreshToken = '';
  try {
    telegram()?.SecureStorage?.removeItem(secureKey);
  } catch {
    /* Storage is optional. */
  }
}
async function responseError(response: Response) {
  const body = await response.json().catch(() => ({}));
  const error = body.error || {};
  return new ApiError(
    response.status,
    error.code || 'request_failed',
    error.message || 'Request failed',
    error.details || {},
  );
}
function safePath(path: string) {
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    path.includes('://') ||
    /[\r\n]/.test(path)
  )
    throw new Error('API path must be relative');
  const url = new URL(API_BASE + path, window.location.origin);
  if (url.origin !== new URL(API_BASE, window.location.origin).origin || !url.pathname.startsWith('/api/v1/'))
    throw new Error('Invalid API path');
  return url.href;
}
async function refresh() {
  if (!refreshToken) throw new ApiError(401, 'session_expired', 'Session expired');
  const response = await fetch(`${API_BASE}/auth/refresh/`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) {
    clearSession();
    throw await responseError(response);
  }
  const data = await response.json();
  setSession(data.access_token, data.refresh_token);
}
export async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = safePath(path);
  const send = () => {
    const headers = new Headers(init.headers);
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    if (typeof init.body === 'string' && !headers.has('Content-Type'))
      headers.set('Content-Type', 'application/json');
    return fetch(url, { ...init, headers, redirect: 'error', credentials: 'omit' });
  };
  let response = await send();
  if (response.status === 401 && refreshToken && !path.startsWith('/auth/')) {
    if (!refreshing)
      refreshing = refresh().finally(() => {
        refreshing = null;
      });
    try {
      await refreshing;
    } catch (error) {
      window.dispatchEvent(new Event('session-expired'));
      throw error;
    }
    response = await send();
  }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('session-expired'));
    throw await responseError(response);
  }
  return response;
}
export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await authenticatedFetch(path, init);
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('Content-Type') || '';
  if (contentType.includes('json') || !contentType) return (await response.json()) as T;
  return (await response.blob()) as T;
}
export async function authenticate(): Promise<Me> {
  const storage = telegram()?.SecureStorage;
  if (storage) {
    const stored = await new Promise<string | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 1500);
      try {
        storage.getItem(secureKey, (error, value) => {
          clearTimeout(timer);
          resolve(error ? null : value);
        });
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });
    if (stored) {
      refreshToken = stored;
      try {
        await refresh();
        return await api<Me>('/me/');
      } catch {
        clearSession();
      }
    }
  }
  const initData = telegram()?.initData;
  if (!initData) throw new ApiError(401, 'telegram_required', 'Open this app in Telegram');
  const data = await api<{
    access_token: string;
    refresh_token: string;
    user: User;
    settings: Settings;
  }>('/auth/telegram/', { method: 'POST', body: JSON.stringify({ init_data: initData }) });
  setSession(data.access_token, data.refresh_token);
  return api<Me>('/me/');
}
