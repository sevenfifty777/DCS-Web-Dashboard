import { NextResponse } from 'next/server';
import { missionClient } from '@/lib/grpc';

export const dynamic = 'force-dynamic';

export async function GET() {
  const activeCalls: any[] = [];

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
          const call = missionClient.StreamUnits({ poll_rate: 1, max_backoff: 1, category });
          activeCalls.push(call);
          
          call.on('data', (data: any) => {
            try {
              const msg = `data: ${JSON.stringify(data)}\n\n`;
              controller.enqueue(new TextEncoder().encode(msg));
            } catch (e) {
              call.cancel();
            }
          });
          
          call.on('end', () => {});
          
          call.on('error', (err: any) => {
            if (err.code !== 1) { // 1 is CANCELLED
              console.error(`StreamUnits error for ${category}:`, err);
            }
          });
        });
      } catch (err) {
        console.error('Failed to start StreamUnits:', err);
        try { controller.close(); } catch(e) {}
      }
    },
    cancel() {
      console.log('Client disconnected from radar stream');
      activeCalls.forEach(call => {
        try { call.cancel(); } catch(e) {}
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
