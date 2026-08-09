import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  
  // If the path is login or auth endpoints, let it pass
  if (
    path === '/login' || 
    path.startsWith('/api/auth') || 
    path.startsWith('/_next') || 
    path.includes('.')
  ) {
    return NextResponse.next();
  }

  // 1. Mobile App Auth: Check for Bearer token
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    if (process.env.MOBILE_API_KEY && token === process.env.MOBILE_API_KEY) {
      return NextResponse.next();
    }
  }

  // 2. Web Auth: Check for the auth cookie
  const authCookie = request.cookies.get('dcs_admin_session');
  if (!authCookie || (authCookie.value !== process.env.ADMIN_PASSWORD && !authCookie.value.startsWith('discord_'))) {
    // If it's an API route, return 401 Unauthorized
    if (path.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Otherwise, redirect to the login page
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Apply to all routes EXCEPT auth, static assets, and images
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
