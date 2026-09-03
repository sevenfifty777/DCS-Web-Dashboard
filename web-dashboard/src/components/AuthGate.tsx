"use client";

// Phase 6 client-side route guard. With the static export there is no server
// middleware, so we gate rendering here: any route other than `/login` requires
// a stored JWT, otherwise we redirect to the login page.
//
// The token lives in localStorage, which does not exist during the prerender.
// The guard must not treat "could not read it yet" as "not authenticated" —
// doing so redirects a signed-in user to /login on every reload even though
// their token is valid and present. So the store has three states rather than
// two: 'unknown' before hydration, then 'in' or 'out' once localStorage has
// actually been read. Only 'out' triggers the redirect.

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { getToken } from '@/lib/api';

type SessionState = 'unknown' | 'in' | 'out';

/** Re-read the token when another tab changes it, or when this tab regains focus. */
function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener('focus', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener('focus', onChange);
  };
}

const getSnapshot = (): SessionState => (getToken() ? 'in' : 'out');

// Prerender/hydration snapshot: localStorage has not been read yet, so the
// session is genuinely unknown. Reporting 'out' here is what caused signed-in
// users to be bounced to /login on every reload.
const getServerSnapshot = (): SessionState => 'unknown';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (session === 'out' && pathname !== '/login') {
      router.replace('/login');
    }
  }, [session, pathname, router]);

  if (pathname === '/login') return <>{children}</>;
  // Still unknown, or signed out and awaiting the redirect.
  if (session !== 'in') return null;
  return <>{children}</>;
}
