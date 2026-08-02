import { Server, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { probeService } from './probe';

const HOST = '127.0.0.1';
let running: Server | undefined;

function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    running = server;
    server.listen(0, HOST, () => resolve((server.address() as AddressInfo).port));
  });
}

function file(port: number, token = 'secret') {
  return { host: HOST, port, token, pid: 0, startedAt: '' };
}

afterEach(async () => {
  const server = running;
  running = undefined;
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('probeService', () => {
  it('recognises a service answering on its own token', async () => {
    const port = await listen((request, response) => {
      response.writeHead(request.headers.authorization === 'Bearer secret' ? 200 : 401);
      response.end();
    });
    expect(await probeService(file(port))).toBe(true);
  });

  it('rejects something else holding the port', async () => {
    const port = await listen((_request, response) => {
      response.writeHead(404);
      response.end();
    });
    expect(await probeService(file(port))).toBe(false);
  });

  it('rejects a service that refuses the recorded token, which means it is not ours', async () => {
    const port = await listen((request, response) => {
      response.writeHead(request.headers.authorization === 'Bearer other' ? 200 : 401);
      response.end();
    });
    expect(await probeService(file(port))).toBe(false);
  });

  it('rejects a stale file whose port nobody is listening on', async () => {
    // A port that was ours and is now free: this is what a hard kill leaves,
    // and it has to resolve to "start a new one" rather than "already running".
    const port = await listen((_request, response) => response.end());
    const server = running;
    running = undefined;
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    expect(await probeService(file(port), 500)).toBe(false);
  });
});
