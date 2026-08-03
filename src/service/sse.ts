import { ServerResponse } from 'node:http';

/**
 * Server-sent events, chosen over a WebSocket because the traffic only goes one
 * way: the service pushes what changed, and the browser posts the occasional
 * command over plain HTTP. SSE also reconnects on its own, which a WebSocket
 * would have made our problem.
 */
export class SseHub {
  private readonly clients = new Set<ServerResponse>();
  private heartbeat?: ReturnType<typeof setInterval>;

  constructor(private readonly heartbeatMs = 20000) {}

  get size(): number {
    return this.clients.size;
  }

  add(response: ServerResponse): void {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nothing about a session should ever be cached by anything in between.
      'X-Accel-Buffering': 'no',
      // This stream is opened with the token in its address like every other
      // route, so it carries the same two headers as the rest.
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    // Tell the browser to come back quickly, and flush the headers now so the
    // connection counts as open even before the first event.
    response.write('retry: 2000\n\n');
    this.clients.add(response);
    response.on('close', () => this.clients.delete(response));
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => this.ping(), this.heartbeatMs);
    }
  }

  send(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      client.write(payload);
    }
  }

  /** A comment line: it keeps the connection open without meaning anything. */
  private ping(): void {
    for (const client of this.clients) {
      client.write(': ping\n\n');
    }
  }

  close(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
  }
}
