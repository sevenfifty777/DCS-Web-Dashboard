import { NextResponse } from 'next/server';
import { getHealth, getVersion } from '@/lib/grpc';

export async function GET() {
  try {
    const [health, version] = await Promise.all([
      getHealth(),
      getVersion(),
    ]);
    return NextResponse.json({ health, version });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to connect to DCS server', details: error.message },
      { status: 500 }
    );
  }
}
