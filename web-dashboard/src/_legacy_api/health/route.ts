import { NextResponse } from 'next/server';
import { getHealth, getVersion } from '@/lib/grpc';
import { errorMessage } from '@/lib/errors';

export async function GET() {
  try {
    const [health, version] = await Promise.all([
      getHealth(),
      getVersion(),
    ]);
    return NextResponse.json({ health, version });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: 'Failed to connect to DCS server', details: errorMessage(error) },
      { status: 500 }
    );
  }
}
