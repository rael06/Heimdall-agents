import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import { STATUS_ORDER, SessionStatus } from '../model/types';
import { AssetReader } from './assets';
import { ServiceEngine } from './engine';
import { guardRequest } from './guard';
import { MAX_NOTIFY_DELAY_SECONDS, MIN_NOTIFY_DELAY_SECONDS } from './preferences';
import { SettingsApi } from './settingsApi';
import { SseHub } from './sse';

export interface ServerOptions {
  token: string;
  port: number;
  /** Absent for a bare service, which has no settings of its own to offer. */
  settings?: SettingsApi;
}

/** Enough for a list of identifiers, and far short of anything worth buffering. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Sent with every answer, whatever it is.
 *
 * `no-referrer` is the one that earns its place. The page is opened with the
 * token in its address, because that is what lets a reload work and a filtered
 * view be kept as a favourite — so the address is a credential, and the browser
 * must never hand it to anywhere else.
 *
 * `nosniff` costs a line and removes the question of what a browser decides a
 * body is when it disagrees with the type we declared.
 */
const COMMON_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/**
 * What the one document is allowed to do.
 *
 * The stylesheet and the script are inlined on purpose — a browser does not
 * carry a query string over to a relative `app.css`, so keeping them separate
 * would mean exempting them from the token. `'unsafe-inline'` is therefore not
 * laxity but the shape of that decision, and everything around it is closed:
 * nothing may be loaded, no form may be submitted anywhere, and the page may
 * not be framed.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  // The interface talks to this service and to nothing else.
  "connect-src 'self'",
  // No image ships with the page; this only keeps the favicon a browser asks
  // for on its own from being reported as a violation.
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function pathOf(url: string | undefined): string {
  const raw = url ?? '/';
  const query = raw.indexOf('?');
  return query < 0 ? raw : raw.slice(0, query);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...COMMON_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    // Nothing here should ever be stored by anything.
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

/** The interface itself, which is the only response a policy applies to. */
function sendPage(response: ServerResponse, body: string): void {
  response.writeHead(200, {
    ...COMMON_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  });
  response.end(body);
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Body too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Body is not JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export interface ServiceServer {
  server: Server;
  /** Closes the streams and the socket, in that order. */
  close(): Promise<void>;
}

export function createServiceServer(engine: ServiceEngine, options: ServerOptions): ServiceServer {
  const hub = new SseHub();
  const assets = new AssetReader();
  const unsubscribe = [
    engine.onDelta((event) => hub.send('delta', event)),
    engine.onState((state) => hub.send('state', state)),
    engine.onMarks((marks) => hub.send('marks', marks)),
  ];

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = pathOf(request.url);
    const method = request.method ?? 'GET';

    if (method === 'GET') {
      if (path === '/') {
        sendPage(response, await assets.read());
        return;
      }
      if (path === '/api/state') {
        sendJson(response, 200, engine.state);
        return;
      }
      if (path === '/api/marks') {
        sendJson(response, 200, engine.currentMarks);
        return;
      }
      if (path === '/api/settings') {
        if (!options.settings) {
          sendJson(response, 404, { error: 'This service has no settings to offer.' });
          return;
        }
        sendJson(response, 200, await options.settings.read());
        return;
      }
      if (path === '/api/settings/detect') {
        if (!options.settings) {
          sendJson(response, 404, { error: 'This service has no settings to offer.' });
          return;
        }
        sendJson(response, 200, { providers: await options.settings.detect() });
        return;
      }
      if (path === '/api/search') {
        const query = new URLSearchParams((request.url ?? '').split('?')[1] ?? '');
        const scope = query.get('scope');
        sendJson(response, 200, {
          matched: await engine.search(
            query.get('q') ?? '',
            scope === 'title' || scope === 'content' ? scope : 'both',
          ),
        });
        return;
      }
      if (path === '/api/sessions') {
        sendJson(response, 200, {
          state: engine.state,
          marks: engine.currentMarks,
          sessions: engine.sessions,
          // What the host can do that the page cannot work out for itself. The
          // desktop application has a menu carrying Settings, so the page hides
          // its own button there; a browser has none and must keep it.
          host: { nativeMenu: options.settings?.hasNativeMenu ?? false },
        });
        return;
      }
      if (path === '/api/events') {
        hub.add(response);
        // The stream opens on the current truth rather than on the next change,
        // so a browser arriving late is not blank until something moves.
        hub.send('state', engine.state);
        hub.send('marks', engine.currentMarks);
        return;
      }
    }

    if (method === 'POST') {
      if (path === '/api/pause') {
        engine.pause();
        sendJson(response, 200, engine.state);
        return;
      }
      if (path === '/api/resume') {
        await engine.resume();
        sendJson(response, 200, engine.state);
        return;
      }
      if (path === '/api/settings') {
        if (!options.settings) {
          sendJson(response, 404, { error: 'This service has no settings to offer.' });
          return;
        }
        sendJson(response, 200, await options.settings.save(asObject(await readJsonBody(request))));
        return;
      }
      if (path === '/api/restart') {
        // Answered before restarting, or the caller never hears back.
        const possible = Boolean(options.settings);
        sendJson(response, 200, { restarting: possible });
        if (possible) {
          setTimeout(() => options.settings?.restart(), 250);
        }
        return;
      }
      if (path === '/api/notifications') {
        const body = asObject(await readJsonBody(request));
        const next: Parameters<typeof engine.setNotifications>[0] = {};
        if (typeof body.enabled === 'boolean') {
          next.enabled = body.enabled;
        }
        if (body.scope === 'unacknowledged' || body.scope === 'watched') {
          next.scope = body.scope;
        }
        if (Array.isArray(body.on)) {
          next.on = body.on.filter((status): status is SessionStatus =>
            (STATUS_ORDER as string[]).includes(status as string),
          );
        }
        // Bounded here as well as on the way to disk: the input's own min and
        // max are a hint to a form and nothing at all to a request typed by
        // hand.
        if (typeof body.delaySeconds === 'number' && Number.isFinite(body.delaySeconds)) {
          next.delaySeconds = Math.min(
            MAX_NOTIFY_DELAY_SECONDS,
            Math.max(MIN_NOTIFY_DELAY_SECONDS, Math.round(body.delaySeconds)),
          );
        }
        sendJson(response, 200, await engine.setNotifications(next));
        return;
      }
      if (path === '/api/refresh') {
        await engine.refresh();
        sendJson(response, 200, engine.state);
        return;
      }
      if (path === '/api/marks/watched' || path === '/api/marks/favorite') {
        const body = asObject(await readJsonBody(request));
        const id = typeof body.id === 'string' ? body.id : '';
        if (!id) {
          sendJson(response, 400, { error: 'An "id" is required.' });
          return;
        }
        const marks =
          path === '/api/marks/watched'
            ? await engine.toggleWatched(id)
            : await engine.toggleFavorite(id);
        sendJson(response, 200, marks);
        return;
      }
      if (path === '/api/open') {
        const body = asObject(await readJsonBody(request));
        const id = typeof body.id === 'string' ? body.id : '';
        const target = body.target;
        if (target !== 'session' && target !== 'workspace' && target !== 'transcript') {
          sendJson(response, 400, { error: 'A "target" of session, workspace or transcript.' });
          return;
        }
        const result = await engine.open(id, target);
        if (!result) {
          sendJson(response, 404, { error: `No session "${id}".` });
          return;
        }
        sendJson(response, 200, result);
        return;
      }
      if (path === '/api/acknowledge') {
        const body = asObject(await readJsonBody(request));
        // The caller sends what it can see, so acknowledging everything settles
        // the rows on screen and never the ones a filter is hiding.
        const ids = Array.isArray(body.ids)
          ? body.ids.filter((id): id is string => typeof id === 'string')
          : [];
        sendJson(response, 200, await engine.acknowledge(ids));
        return;
      }
      if (path === '/api/status') {
        const body = asObject(await readJsonBody(request));
        const id = typeof body.id === 'string' ? body.id : '';
        // `null` is how the interface asks for the inferred status back, so it
        // is a value here rather than a missing field. Anything that is not one
        // of the four is refused rather than stored: this file is read back on
        // every scan, and a status nothing knows how to draw would reach the
        // table.
        const wanted = body.status;
        const status =
          wanted === null
            ? null
            : STATUS_ORDER.find((candidate) => candidate === wanted);
        if (!id || status === undefined) {
          sendJson(response, 400, { error: 'An id and one of the four statuses, or null.' });
          return;
        }
        sendJson(response, 200, { sessions: await engine.setStatus(id, status) });
        return;
      }
    }

    sendJson(response, 404, { error: `No route for ${method} ${path}.` });
  };

  const server = createServer((request, response) => {
    const guard = guardRequest(request.headers, request.url ?? '/', options);
    if (!guard.allowed) {
      sendJson(response, guard.status, { error: guard.reason });
      return;
    }
    handle(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      sendJson(response, 400, { error: String(error instanceof Error ? error.message : error) });
    });
  });

  return {
    server,
    close: () =>
      new Promise<void>((resolve) => {
        for (const off of unsubscribe) {
          off();
        }
        hub.close();
        server.close(() => resolve());
      }),
  };
}
