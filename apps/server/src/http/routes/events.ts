import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';

/** SSE stream of `candle` and `status` events, per docs/DESIGN.md section 7. */
export function registerEventsRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/events', (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    reply.raw.write('\n');

    const offCandle = deps.events.onCandle((symbol, candle) => {
      reply.raw.write(`event: candle\ndata: ${JSON.stringify({ symbol, candle })}\n\n`);
    });
    const offStatus = deps.events.onStatus((symbol, status) => {
      reply.raw.write(`event: status\ndata: ${JSON.stringify({ symbol, status })}\n\n`);
    });

    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, 15_000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      offCandle();
      offStatus();
    });
  });
}
