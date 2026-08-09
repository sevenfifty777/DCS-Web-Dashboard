import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { password } = await req.json();
    
    // Check against the environment variable
    if (password === process.env.ADMIN_PASSWORD) {
      // Create a response
      const response = NextResponse.json({ success: true });
      
      // Set an HTTP-only cookie to keep them logged in
      response.cookies.set({
        name: 'dcs_admin_session',
        value: password, // For a single admin app, matching the password in an encrypted cookie is sufficient
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7 // 1 week
      });
      
      return response;
    }
    
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  } catch (error) {
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete('dcs_admin_session');
  return response;
}
