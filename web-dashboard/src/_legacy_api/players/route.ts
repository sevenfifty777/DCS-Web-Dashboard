import { NextResponse } from 'next/server';
import { getPlayers } from '@/lib/grpc';
import { errorMessage } from '@/lib/errors';

export async function GET() {
  try {
    const response = await getPlayers();
    return NextResponse.json({ players: response.players || [] });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: 'Failed to fetch players', details: errorMessage(error) },
      { status: 500 }
    );
  }
}
