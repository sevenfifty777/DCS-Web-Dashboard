import { NextResponse } from 'next/server';
import { getUserFlag, setUserFlag } from '@/lib/grpc';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const flag = searchParams.get('flag');
    if (!flag) {
      return NextResponse.json({ error: 'Flag parameter is required' }, { status: 400 });
    }
    const res: any = await getUserFlag(flag);
    return NextResponse.json({ flag, value: res.value });
  } catch (err: any) {
    console.error('Failed to get flag:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { flag, value } = await req.json();
    if (flag === undefined || value === undefined) {
      return NextResponse.json({ error: 'Flag and value are required' }, { status: 400 });
    }
    await setUserFlag(flag.toString(), Number(value));
    return NextResponse.json({ success: true, flag, value: Number(value) });
  } catch (err: any) {
    console.error('Failed to set flag:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
