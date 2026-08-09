import { NextResponse } from 'next/server';

export async function GET() {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = encodeURIComponent(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'}/api/auth/callback`);
  
  if (!clientId) {
    return NextResponse.json({ error: 'Discord Client ID not configured in .env.local' }, { status: 500 });
  }

  // We need 'identify' to get their user profile, and 'guilds.members.read' to see their roles in the guild
  const scope = 'identify guilds.members.read';
  const discordUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${encodeURIComponent(scope)}`;
  
  return NextResponse.redirect(discordUrl);
}
