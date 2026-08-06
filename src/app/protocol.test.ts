import { describe, expect, it } from 'vitest';
import { ackUri, openUri, parseRequest, requestFromArgv, showUri } from './protocol';

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

  it('reads a request to mark a session seen, which opens nothing', () => {
    expect(parseRequest('heimdall-agents://ack?id=codex%3Axyz')).toEqual({
      kind: 'ack',
      id: 'codex:xyz',
    });
  });

  it('reads back exactly what it writes', () => {
    expect(parseRequest(openUri('claude:a b&c'))).toEqual({ kind: 'open', id: 'claude:a b&c' });
    expect(parseRequest(ackUri('claude:a b&c'))).toEqual({ kind: 'ack', id: 'claude:a b&c' });
    expect(parseRequest(showUri())).toEqual({ kind: 'show' });
  });

  it('keeps the two apart, since one opens a window and the other must not', () => {
    // A toast carries both, one button apart. Reading either as the other is
    // the difference between dismissing a notification and switching editor.
    expect(ackUri('x')).not.toBe(openUri('x'));
    expect(parseRequest(ackUri('x'))?.kind).toBe('ack');
    expect(parseRequest(openUri('x'))?.kind).toBe('open');
  });

  it('refuses an acknowledgement without a session', () => {
    expect(parseRequest('heimdall-agents://ack')).toBeUndefined();
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
