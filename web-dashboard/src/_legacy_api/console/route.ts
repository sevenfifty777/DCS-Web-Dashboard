import { NextResponse } from 'next/server';
import { customEval } from '@/lib/grpc';
import { errorMessage } from '@/lib/errors';

export async function POST(req: Request) {
  try {
    const { lua } = await req.json();
    if (!lua) {
      return NextResponse.json({ error: 'Lua script is required' }, { status: 400 });
    }
    const res = await customEval(lua);
    return NextResponse.json({ result: res.json });
  } catch (err: unknown) {
    console.error('Failed to eval lua:', err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
