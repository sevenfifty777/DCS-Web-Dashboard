import { NextResponse } from 'next/server';
import { sendChat } from '@/lib/grpc';
import { errorMessage } from '@/lib/errors';

export async function POST(req: Request) {
  try {
    const { message, coalition } = await req.json();
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }
    await sendChat(message, coalition || 'COALITION_ALL');
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: 'Failed to send chat', details: errorMessage(error) },
      { status: 500 }
    );
  }
}
