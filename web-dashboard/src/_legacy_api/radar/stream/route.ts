import { NextResponse } from 'next/server';
import { streamUnits } from '@/lib/grpc';
import { errorCode } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET() {
  const activeCalls: ReturnType<typeof streamUnits>[] = [];

  const stream = new ReadableStream({
    start(controller) {
      try {
        // Explicitly subscribe to all categories to ensure planes are streamed
        const categories = [
          'GROUP_CATEGORY_AIRPLANE',
          'GROUP_CATEGORY_HELICOPTER',
          'GROUP_CATEGORY_GROUND',
          'GROUP_CATEGORY_SHIP'
        ];

        categories.forEach(category => {
          const call = streamUnits(category);
          activeCalls.push(call);
          
          call.on('data', (data: unknown) => {
            try {
              const msg = `data: ${JSON.stringify(data)}\n\n`;
              controller.enqueue(new TextEncoder().encode(msg));
            } catch {
              call.cancel();
            }
          });
          
          call.on('error', (err: unknown) => {
            if (errorCode(err) !== '1' && errorCode(err) !== 'CANCELLED') {
              console.error(`StreamUnits error for ${category}:`, err);
            }
          });
        });
      } catch (err) {
        console.error('Failed to start StreamUnits:', err);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      console.log('Client disconnected from radar stream');
      activeCalls.forEach(call => {
        try { call.cancel(); } catch { /* already cancelled */ }
      });
    }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
