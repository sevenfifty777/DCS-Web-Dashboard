import { NextResponse } from 'next/server';
import { customEval } from '@/lib/grpc';

export async function POST(req: Request) {
  try {
    const { lua } = await req.json();
    if (!lua) {
      return NextResponse.json({ error: 'Lua script is required' }, { status: 400 });
    }
    const res: any = await customEval(lua);
    return NextResponse.json({ result: res.json });
  } catch (err: any) {
    console.error('Failed to eval lua:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
