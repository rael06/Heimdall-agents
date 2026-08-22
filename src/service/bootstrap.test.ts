import { describe, expect, it } from 'vitest';
import { portUnavailable } from './bootstrap';

describe('portUnavailable', () => {
  it('sends the caller to another port when something holds this one', () => {
    expect(portUnavailable('EADDRINUSE')).toBe(true);
  });

  it('does the same for a port the system refuses although nothing is listening', () => {
    // Windows: Hyper-V and WSL reserve blocks of the dynamic range, redrawn on
    // every boot, and a port inside one comes back EACCES with no listener on
    // it. Measured — a machine restarted overnight came back with 27520-27619
    // excluded, which covers the port this application asks for first. Read as
    // a real permission error it took the whole start down: the window, the
    // tray and the menu are all built after the service, so the application
    // came up owning nothing and saying nothing.
    expect(portUnavailable('EACCES')).toBe(true);
  });

  it('leaves anything else to be reported as itself', () => {
    // A fallback port would answer none of these, and hide them while it tried.
    expect(portUnavailable('EADDRNOTAVAIL')).toBe(false);
    expect(portUnavailable('ENOTFOUND')).toBe(false);
    expect(portUnavailable(undefined)).toBe(false);
  });
});
