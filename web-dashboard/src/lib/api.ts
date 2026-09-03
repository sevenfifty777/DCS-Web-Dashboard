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
 * Did this 401 mean "your session is no longer valid"?
 *
 * The backend tags auth rejections with a `reason` (see `AuthError` in
 * `rust-web-dashboard/src/auth.rs`). Only a rejection of the token itself should end the
 * session — any other 401 is left for the caller to handle, so that one incidental
 * failure cannot log the user out and disguise the real error as a login prompt.
 *
 * A 401 we cannot read (opaque body, proxy-generated error page) is treated as NOT a
 * session rejection: the cost of ignoring a real logout is one failed request, whereas
 * the cost of a false logout is losing a valid session.
 */
async function isSessionRejected(res: Response): Promise<boolean> {
  // Older backends answered 401 with no `reason`; without a token there was no session
  // to lose, so treat that case as a rejection to preserve the previous behaviour.
  if (!getToken()) return true;

  try {
    const body = await res.clone().json();
    return body?.reason === 'token_invalid' || body?.reason === 'token_missing';
  } catch {
    return false;
  }
}

/**
 * Same-origin `fetch` that injects the JWT Bearer token. If the server rejects the
 * session it clears the stored token and redirects to `/login`; other 401s are returned
 * to the caller untouched. Preserves the caller's method, body, and any custom headers
 * (so JSON and FormData uploads both work).
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

  if (res.status === 401 && (await isSessionRejected(res))) {
    clearToken();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  return res;
}
