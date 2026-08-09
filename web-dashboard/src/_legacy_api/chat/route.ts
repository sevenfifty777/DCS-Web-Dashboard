import { NextResponse } from 'next/server';
import { sendChat } from '@/lib/grpc';

export async function POST(req: Request) {
  try {
    const { message, coalition } = await req.json();
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }
    await sendChat(message, coalition || 'COALITION_ALL');
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to send chat', details: error.message },
      { status: 500 }
    );
  }
}
