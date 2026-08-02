import { describe, expect, it } from 'vitest';
import { guardRequest, tokenFromRequest } from './guard';

const options = { token: 'secret', port: 27600 };
const ok = { host: '127.0.0.1:27600' };

describe('tokenFromRequest', () => {
  it('reads a bearer token', () => {
    expect(tokenFromRequest({ authorization: 'Bearer abc' }, '/api/state')).toBe('abc');
  });

  it('reads a token from the query string', () => {
    expect(tokenFromRequest({}, '/api/state?token=abc')).toBe('abc');
  });

  it('prefers the header when both are present', () => {
    expect(tokenFromRequest({ authorization: 'Bearer header' }, '/api/state?token=query')).toBe(
      'header',
    );
  });

  it('finds nothing when there is nothing', () => {
    expect(tokenFromRequest({}, '/api/state')).toBeUndefined();
    expect(tokenFromRequest({}, '/api/state?other=1')).toBeUndefined();
  });
});

describe('guardRequest', () => {
  it('allows a loopback request carrying the token', () => {
    expect(guardRequest({ ...ok }, '/api/state?token=secret', options)).toEqual({ allowed: true });
    expect(
      guardRequest({ ...ok, authorization: 'Bearer secret' }, '/api/state', options),
    ).toEqual({ allowed: true });
  });

  it('allows every loopback spelling we listen on', () => {
    for (const host of ['localhost:27600', '127.0.0.1:27600', '[::1]:27600']) {
      expect(guardRequest({ host }, '/api/state?token=secret', options)).toEqual({ allowed: true });
    }
  });

  it('refuses a host that is not the loopback, which is how DNS rebinding arrives', () => {
    const result = guardRequest({ host: 'evil.example:27600' }, '/api/state?token=secret', options);
    expect(result).toMatchObject({ allowed: false, status: 403 });
  });

  it('refuses the right host on the wrong port', () => {
    expect(guardRequest({ host: '127.0.0.1:9999' }, '/api/state?token=secret', options)).toMatchObject({
      allowed: false,
      status: 403,
    });
  });

  it('refuses a request with no host at all', () => {
    expect(guardRequest({}, '/api/state?token=secret', options)).toMatchObject({ allowed: false });
  });

  it('refuses a cross-origin request, even with a valid token', () => {
    const result = guardRequest(
      { ...ok, origin: 'https://evil.example' },
      '/api/state?token=secret',
      options,
    );
    expect(result).toMatchObject({ allowed: false, status: 403, reason: 'Origin not allowed.' });
  });

  it('allows our own origin', () => {
    expect(
      guardRequest({ ...ok, origin: 'http://127.0.0.1:27600' }, '/api/state?token=secret', options),
    ).toEqual({ allowed: true });
  });

  it('refuses a request with no token', () => {
    expect(guardRequest({ ...ok }, '/api/state', options)).toMatchObject({
      allowed: false,
      status: 401,
    });
  });

  it('refuses a wrong token', () => {
    expect(guardRequest({ ...ok }, '/api/state?token=guess', options)).toMatchObject({
      allowed: false,
      status: 401,
    });
  });
});
