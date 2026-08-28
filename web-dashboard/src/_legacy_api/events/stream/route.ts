import { streamMissionEvents } from '@/lib/grpc';
import { errorCode } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      let call: ReturnType<typeof streamMissionEvents> | undefined;
      try {
        call = streamMissionEvents();
        call.on('data', (data: unknown) => {
          try {
            const msg = `data: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(new TextEncoder().encode(msg));
          } catch {
            call?.cancel();
          }
        });
        
        call.on('end', () => {
          try { controller.close(); } catch { /* already closed */ }
        });
        
        call.on('error', (err: unknown) => {
          if (errorCode(err) !== '1' && errorCode(err) !== 'CANCELLED') {
            console.error('StreamEvents error:', err);
          }
          try { controller.close(); } catch { /* already closed */ }
        });
      } catch (err) {
        console.error('Failed to start StreamEvents:', err);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      console.log('Client disconnected from events stream');
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
