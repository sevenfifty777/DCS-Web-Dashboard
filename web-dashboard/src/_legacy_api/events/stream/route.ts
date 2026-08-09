import { missionClient } from '@/lib/grpc';

export const dynamic = 'force-dynamic';

export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      let call: any;
      try {
        call = missionClient.StreamEvents({});
        
        call.on('data', (data: any) => {
          try {
            const msg = `data: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(new TextEncoder().encode(msg));
          } catch (e) {
            call.cancel();
          }
        });
        
        call.on('end', () => {
          try { controller.close(); } catch(e) {}
        });
        
        call.on('error', (err: any) => {
          if (err.code !== 1) { // 1 = CANCELLED
            console.error('StreamEvents error:', err);
          }
          try { controller.close(); } catch(e) {}
        });
      } catch (err) {
        console.error('Failed to start StreamEvents:', err);
        try { controller.close(); } catch(e) {}
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
