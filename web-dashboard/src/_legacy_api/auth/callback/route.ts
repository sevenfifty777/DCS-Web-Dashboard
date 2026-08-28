import { NextResponse } from 'next/server';
import { logAuthEvent } from '@/lib/logger';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=No+Code+Provided', baseUrl));
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const guildId = process.env.DISCORD_GUILD_ID;
  const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID;
  const redirectUri = `${baseUrl}/api/auth/callback`;

  if (!clientId || !clientSecret || !guildId || !adminRoleId) {
    return NextResponse.redirect(new URL('/login?error=Server+Configuration+Missing', baseUrl));
  }

  try {
    // 1. Exchange code for access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error('Failed to get token: ' + JSON.stringify(tokenData));

    const accessToken = tokenData.access_token;

    // 2. Fetch the user's guild member profile for our specific guild
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const userData = await userRes.json();
    const discordUsername = userData.username || 'Unknown User';
    const discordUserId = userData.id || 'Unknown ID';

    const memberRes = await fetch(`https://discord.com/api/users/@me/guilds/${guildId}/member`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (memberRes.status === 404) {
      await logAuthEvent({ username: discordUsername, userId: discordUserId, status: 'REJECTED', reason: 'Not a member of the required Discord server' });
      return NextResponse.redirect(new URL('/login?error=You+are+not+a+member+of+the+NOeZ+server', baseUrl));
    }
    
    if (!memberRes.ok) {
      throw new Error('Failed to fetch guild member data');
    }

    const memberData = await memberRes.json();
    const roles: string[] = memberData.roles || [];

    // 3. Verify they have at least one of the required roles
    const allowedRoles = adminRoleId.split(',').map((r: string) => r.trim());
    const hasAllowedRole = roles.some((r: string) => allowedRoles.includes(r));

    if (!hasAllowedRole) {
      await logAuthEvent({ username: discordUsername, userId: discordUserId, status: 'REJECTED', reason: 'Missing Admin Role' });
      return NextResponse.redirect(new URL('/login?error=Unauthorized:+Missing+Admin+Role', baseUrl));
    }

    // Success! Log it.
    await logAuthEvent({ username: discordUsername, userId: discordUserId, status: 'SUCCESS' });

    // 4. Issue the secure session cookie
    const response = NextResponse.redirect(new URL('/', baseUrl));
    response.cookies.set({
      name: 'dcs_admin_session',
      value: `discord_${memberData.user.id}`, // Store their discord ID as the session token
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7 // 1 week
    });

    return response;

  } catch (err: unknown) {
    console.error('Discord Auth Error:', err);
    return NextResponse.redirect(new URL('/login?error=Authentication+Failed', baseUrl));
  }
}
