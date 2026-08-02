import { describe, expect, it } from 'vitest';
import { openUri, parseRequest, requestFromArgv, showUri } from './protocol';

describe('parseRequest', () => {
  it('reads a request to open a session', () => {
    expect(parseRequest('heimdall-agents://open?id=claude%3Aabc')).toEqual({
      kind: 'open',
      id: 'claude:abc',
    });
  });

  it('reads a request to bring the list up', () => {
    expect(parseRequest('heimdall-agents://show')).toEqual({ kind: 'show' });
  });

  it('reads back exactly what it writes', () => {
    expect(parseRequest(openUri('claude:a b&c'))).toEqual({ kind: 'open', id: 'claude:a b&c' });
    expect(parseRequest(showUri())).toEqual({ kind: 'show' });
  });

  it('refuses another scheme, which is what a hostile link would use', () => {
    expect(parseRequest('vscode://file/C:/x')).toBeUndefined();
    expect(parseRequest('https://evil.example/open?id=x')).toBeUndefined();
  });

  it('refuses a route it does not know', () => {
    expect(parseRequest('heimdall-agents://delete?id=x')).toBeUndefined();
  });

  it('refuses an open without a session', () => {
    expect(parseRequest('heimdall-agents://open')).toBeUndefined();
  });

  it('refuses anything that is not a URI at all', () => {
    expect(parseRequest('')).toBeUndefined();
    expect(parseRequest('--inspect')).toBeUndefined();
  });
});

describe('requestFromArgv', () => {
  it('finds the URI among the arguments Windows passes through', () => {
    expect(
      requestFromArgv(['C:\\app.exe', '--allow-file-access', 'heimdall-agents://show']),
    ).toEqual({ kind: 'show' });
  });

  it('finds nothing in a plain launch', () => {
    expect(requestFromArgv(['C:\\app.exe'])).toBeUndefined();
  });
});
