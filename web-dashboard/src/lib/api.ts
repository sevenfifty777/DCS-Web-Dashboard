// Phase 6 client auth helper.
//
// The dashboard is served as a static export embedded in the Rust binary and
// talks to the Rust backend over same-origin `/api`. Authentication is a JWT
// Bearer token (issued by `POST /api/auth` or the Discord callback) stored in
// localStorage. `apiFetch` attaches the token and, on a 401, clears it and
// bounces the user back to the login page.

const TOKEN_KEY = 'dcs_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
}

/**
 * Same-origin `fetch` that injects the JWT Bearer token. On HTTP 401 it clears
 * the stored token and redirects to `/login`. Preserves the caller's method,
 * body, and any custom headers (so JSON and FormData uploads both work).
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const url = new URL(input, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  if (init.method === undefined || init.method.toUpperCase() === 'GET') {
    url.searchParams.set('_t', Date.now().toString());
  }

  const res = await fetch(url.toString(), { cache: 'no-store', ...init, headers });

  if (res.status === 401) {
    clearToken();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  return res;
}
