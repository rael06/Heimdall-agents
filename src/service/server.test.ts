import { request as httpRequest } from 'node:http';
import { AddressInfo, createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ServiceEngine } from './engine';
import { SettingsApi } from './settingsApi';
import { ServiceServer, createServiceServer, pathOf } from './server';

/**
 * The HTTP surface, driven over a real socket.
 *
 * 276 lines carrying every route, every piece of request validation and the
 * guard that stands in front of them, with no test of its own — the interface
 * suite exercises the happy path of a handful of routes through a browser, and
 * nothing at all asked what happens to a request that is malformed, unauthorised,
 * or aimed at a route that does not exist.
 */

const TOKEN = 'a'.repeat(64);

const state = {
  paused: false,
  watching: ['/root'],
  watchFailures: [],
  providers: [],
  truncated: 0,
  sessions: 1,
  scannedAt: '2026-08-03T10:00:00.000Z',
  notifications: { enabled: true, on: ['idle'], scope: 'watched' },
};

const marks = { watched: ['claude:a'], favorites: [], unacknowledged: ['claude:a'] };

/** Only what the server actually reaches for. */
function fakeEngine() {
  return {
    state,
    currentMarks: marks,
    sessions: [{ id: 'claude:a', title: 'A session' }],
    onDelta: () => () => undefined,
    onState: () => () => undefined,
    onMarks: () => () => undefined,
    search: vi.fn(async () => ({ 'claude:a': ['title'] })),
    pause: vi.fn(),
    resume: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    setNotifications: vi.fn(async () => state),
    toggleWatched: vi.fn(async () => marks),
    toggleFavorite: vi.fn(async () => marks),
    acknowledge: vi.fn(async () => marks),
    open: vi.fn(async (id: string) => (id === 'claude:a' ? { opened: [], fellBack: false } : undefined)),
  };
}

function fakeSettings() {
  return {
    read: vi.fn(async () => ({ providers: {}, scan: {}, notifications: {}, effective: {} })),
    detect: vi.fn(async () => [{ provider: 'claude', candidates: [], best: undefined }]),
    save: vi.fn(async (request: unknown) => ({ saved: request, restartRequired: false })),
    restart: vi.fn(() => true),
    readView: vi.fn(async () => ({ theme: 'dark' })),
    saveView: vi.fn(async (_patch: Record<string, string | null>) => undefined),
  };
}

let engine: ReturnType<typeof fakeEngine>;
let settings: ReturnType<typeof fakeSettings>;
let running: ServiceServer;
let origin: string;
let port: number;

/**
 * A port nobody is using, released before it is claimed again.
 *
 * The guard compares the request's `Host` against the port it was told it
 * listens on, so that number has to be known before the server is built rather
 * than discovered from the socket afterwards.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port: found } = probe.address() as AddressInfo;
      probe.close(() => resolve(found));
    });
  });
}

beforeAll(async () => {
  engine = fakeEngine();
  settings = fakeSettings();
  port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  running = createServiceServer(engine as unknown as ServiceEngine, {
    token: TOKEN,
    port,
    settings: settings as unknown as SettingsApi,
  });
  await new Promise<void>((resolve) => running.server.listen(port, '127.0.0.1', () => resolve()));
});

afterAll(async () => {
  await running.close();
});

/** Every request needs the token and a Host the guard recognises. */
const get = (path: string, init: RequestInit = {}) =>
  fetch(`${origin}${path}${path.includes('?') ? '&' : '?'}token=${TOKEN}`, init);

const post = (path: string, body?: unknown) =>
  get(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

/** `Response.json()` is `unknown`, and every body this service sends is an object. */
const bodyOf = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>;

describe('pathOf', () => {
  it('drops the query string, which is where the token rides', () => {
    expect(pathOf('/api/state?token=abc')).toBe('/api/state');
    expect(pathOf('/api/state')).toBe('/api/state');
    expect(pathOf(undefined)).toBe('/');
  });
});

describe('the guard, over a real socket', () => {
  it('refuses a request carrying no token', async () => {
    const response = await fetch(`${origin}/api/state`);
    expect(response.status).toBe(401);
  });

  it('refuses a token that is merely the right length', async () => {
    const response = await fetch(`${origin}/api/state?token=${'b'.repeat(64)}`);
    expect(response.status).toBe(401);
  });

  it('accepts the token as a bearer header as well as in the address', async () => {
    const response = await fetch(`${origin}/api/state`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
  });

  it('refuses a cross-origin request even when it carries the token', async () => {
    // A hostile page can point its own name at 127.0.0.1; the Origin is what
    // gives it away.
    const response = await get('/api/state', { headers: { origin: 'https://evil.test' } });
    expect(response.status).toBe(403);
  });

  it('refuses a Host that is not the loopback name we listen on', async () => {
    // Through node:http rather than fetch: Host is a forbidden header name,
    // and undici drops an override silently — so a fetch-based version of this
    // test would have passed against a server with no Host check at all.
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: `/api/state?token=${TOKEN}`,
          headers: { host: `evil.test:${port}` },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on('error', reject);
      request.end();
    });
    expect(status).toBe(403);
  });
});

describe('what the routes answer', () => {
  it('serves the interface as one document, under a policy', async () => {
    const response = await get('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const html = await response.text();
    // The stylesheet and both scripts are inlined, so this is the whole surface.
    expect(html).toContain('<style>');
    expect(html).toContain('<script type="module">');
    expect(html).not.toContain('{{styles}}');
    expect(html).not.toContain('{{script}}');
    // The stored view rides in the document rather than being fetched: the
    // theme decides the first paint and cannot wait for a round trip.
    expect(html).toContain('window.__view = {"theme":"dark"}');
    expect(html).not.toContain('{{view}}');
  });

  it('saves what the page keeps, and drops a key on null', async () => {
    const response = await post('/api/view', { primary: '#fa1f19', columns: null, bogus: 7 });
    expect(response.status).toBe(200);
    // The number is not refused, it is left out: a value the interface cannot
    // have written is not worth failing a column drag over.
    expect(settings.saveView).toHaveBeenCalledWith({ primary: '#fa1f19', columns: null });
  });

  it('does not let an older view write overwrite a newer one from the same page', async () => {
    const callsBefore = settings.saveView.mock.calls.length;
    await post('/api/view', {
      writer: 'one-page',
      revision: 2,
      patch: { columnLayout: 'new' },
    });
    await post('/api/view', {
      writer: 'one-page',
      revision: 1,
      patch: { columnLayout: 'old' },
    });

    expect(settings.saveView).toHaveBeenCalledTimes(callsBefore + 1);
    expect(settings.saveView).toHaveBeenCalledWith({ columnLayout: 'new' });
  });

  it('carries the same two headers on an API answer', async () => {
    const response = await get('/api/state');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('hands back the state, the marks and the sessions', async () => {
    expect(await (await get('/api/state')).json()).toMatchObject({ paused: false });
    expect(await (await get('/api/marks')).json()).toMatchObject({ watched: ['claude:a'] });
    const all = await bodyOf(await get('/api/sessions'));
    expect(all.sessions).toHaveLength(1);
    expect(all.marks).toBeDefined();
    expect(all.state).toBeDefined();
  });

  it('passes a search through, and only a scope it recognises', async () => {
    await get('/api/search?q=importer&scope=title');
    expect(engine.search).toHaveBeenLastCalledWith('importer', 'title');
    // Anything else means both, rather than being refused or passed on.
    await get('/api/search?q=importer&scope=sideways');
    expect(engine.search).toHaveBeenLastCalledWith('importer', 'both');
    await get('/api/search');
    expect(engine.search).toHaveBeenLastCalledWith('', 'both');
  });

  it('answers 404 for a route it does not have, on either method', async () => {
    expect((await get('/api/nothing')).status).toBe(404);
    expect((await post('/api/nothing')).status).toBe(404);
    // A GET-only route is not a POST route.
    expect((await post('/api/state')).status).toBe(404);
  });
});

describe('what the routes refuse', () => {
  it('wants an id before it will toggle a mark', async () => {
    expect((await post('/api/marks/watched', {})).status).toBe(400);
    expect((await post('/api/marks/favorite', { id: 42 })).status).toBe(400);
    expect((await post('/api/marks/watched', { id: 'claude:a' })).status).toBe(200);
  });

  it('wants a target it knows before it will open anything', async () => {
    expect((await post('/api/open', { id: 'claude:a' })).status).toBe(400);
    expect((await post('/api/open', { id: 'claude:a', target: 'elsewhere' })).status).toBe(400);
    expect((await post('/api/open', { id: 'claude:a', target: 'session' })).status).toBe(200);
  });

  it('says so when the session is not one it holds', async () => {
    const response = await post('/api/open', { id: 'claude:gone', target: 'session' });
    expect(response.status).toBe(404);
  });

  it('keeps only the statuses it recognises out of a notification request', async () => {
    await post('/api/notifications', {
      enabled: true,
      scope: 'unacknowledged',
      on: ['idle', 'not-a-status', 7, 'running'],
    });
    expect(engine.setNotifications).toHaveBeenLastCalledWith({
      enabled: true,
      scope: 'unacknowledged',
      on: ['idle', 'running'],
    });
  });

  it('ignores a scope and an enabled flag of the wrong shape', async () => {
    await post('/api/notifications', { enabled: 'yes', scope: 'whenever' });
    expect(engine.setNotifications).toHaveBeenLastCalledWith({});
  });

  it('keeps only the identifiers out of an acknowledgement', async () => {
    await post('/api/acknowledge', { ids: ['claude:a', null, 3, 'claude:b'] });
    expect(engine.acknowledge).toHaveBeenLastCalledWith(['claude:a', 'claude:b']);
    // Nothing at all is an empty list, not a failure.
    await post('/api/acknowledge', {});
    expect(engine.acknowledge).toHaveBeenLastCalledWith([]);
  });

  it('refuses a body that is not JSON rather than crashing on it', async () => {
    const response = await fetch(`${origin}/api/acknowledge?token=${TOKEN}`, {
      method: 'POST',
      body: 'not json at all',
    });
    expect(response.status).toBe(400);
    expect((await bodyOf(response)).error).toMatch(/not JSON/);
  });

  it('refuses a body far larger than a list of identifiers', async () => {
    const response = await fetch(`${origin}/api/acknowledge?token=${TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [ 'x'.repeat(128 * 1024) ] }),
    }).catch(() => undefined);
    // The socket is destroyed once the cap is passed, so either a 400 comes
    // back or the connection goes away. Both are a refusal; neither is buffered.
    expect(response === undefined || response.status === 400).toBe(true);
  });
});

describe('the pause and restart controls', () => {
  it('pauses and resumes through the engine', async () => {
    await post('/api/pause');
    expect(engine.pause).toHaveBeenCalled();
    await post('/api/resume');
    expect(engine.resume).toHaveBeenCalled();
    await post('/api/refresh');
    expect(engine.refresh).toHaveBeenCalled();
  });

  it('answers before restarting, or the caller never hears back', async () => {
    const response = await post('/api/restart');
    expect(await response.json()).toEqual({ restarting: true });
  });
});

describe('a service with no settings of its own', () => {
  it('offers none rather than pretending', async () => {
    const barePort = await freePort();
    const bare = createServiceServer(fakeEngine() as unknown as ServiceEngine, {
      token: TOKEN,
      port: barePort,
    });
    await new Promise<void>((resolve) =>
      bare.server.listen(barePort, '127.0.0.1', () => resolve()),
    );
    const at = (path: string) => `http://127.0.0.1:${barePort}${path}?token=${TOKEN}`;

    expect((await fetch(at('/api/settings'))).status).toBe(404);
    expect((await fetch(at('/api/settings/detect'))).status).toBe(404);
    // And a restart it cannot perform is reported as one it will not.
    const restart = await fetch(at('/api/restart'), { method: 'POST' });
    expect(await restart.json()).toEqual({ restarting: false });

    await bare.close();
  });
});
