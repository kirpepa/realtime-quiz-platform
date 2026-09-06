// An explicitly empty VITE_API_URL means same-origin (the Docker image serves
// the built SPA and API together). Local development uses the example value.
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const ACCESS_KEY = 'quiz_access';
const REFRESH_KEY = 'quiz_refresh';

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access, refresh) {
    if (access) localStorage.setItem(ACCESS_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

// Turns the full image path from the API into an absolute URL.
export function assetUrl(path) {
  if (!path) return '';
  return path.startsWith('http') ? path : `${API_URL}${path}`;
}

let refreshPromise = null;

// Refreshes the access token. Single-flight: concurrent 401s share one request
// instead of firing several parallel /refresh calls.
function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const refresh = tokenStore.refresh;
    if (!refresh) return false;
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    tokenStore.set(data.accessToken, data.refreshToken);
    return true;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

// Socket handshakes cannot transparently replay through the REST helper. This
// check refreshes an expired access token first and returns the current value.
export async function getSocketAccessToken() {
  if (!tokenStore.access) return null;
  try {
    await api('/api/auth/me');
    return tokenStore.access;
  } catch {
    return null;
  }
}

// Forces a logout when the session can no longer be refreshed. AuthProvider
// listens for this event to clear the user and let ProtectedRoute redirect.
function forceLogout() {
  tokenStore.clear();
  window.dispatchEvent(new Event('auth:logout'));
}

// Core request helper. Adds the bearer token, parses JSON, throws on error,
// and transparently retries once after refreshing an expired access token.
export async function api(path, { method = 'GET', body, isForm = false, _retry = false } = {}) {
  const headers = {};
  if (!isForm) headers['Content-Type'] = 'application/json';
  const access = tokenStore.access;
  if (access) headers.Authorization = `Bearer ${access}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !_retry && tokenStore.refresh) {
    const ok = await refreshAccessToken();
    if (ok) return api(path, { method, body, isForm, _retry: true });
    // Refresh token is gone/expired — end the session cleanly.
    forceLogout();
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Ошибка запроса (${res.status})`);
  }
  return data;
}
