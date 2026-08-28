"use client";

// Phase 6 client-side route guard. With the static export there is no server
// middleware, so we gate rendering here: any route other than `/login` requires
// a stored JWT, otherwise we redirect to the login page.

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { getToken } from '@/lib/api';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const hasToken = useSyncExternalStore(
    () => () => undefined,
    () => Boolean(getToken()),
    () => false,
  );

  useEffect(() => {
    if (pathname !== '/login' && !hasToken) {
      router.replace('/login');
    }
  }, [hasToken, pathname, router]);

  if (pathname !== '/login' && !hasToken) return null;
  return <>{children}</>;
}
