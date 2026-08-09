import { NextResponse } from 'next/server';
import { getPlayers } from '@/lib/grpc';

export async function GET() {
  try {
    const response: any = await getPlayers();
    return NextResponse.json({ players: response.players || [] });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to fetch players', details: error.message },
      { status: 500 }
    );
  }
}
