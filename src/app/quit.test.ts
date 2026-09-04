import { describe, expect, it, vi } from 'vitest';
import { QuitCoordinator } from './quit';

describe('QuitCoordinator', () => {
  it('holds every quit request until one preparation has finished', async () => {
    let finish: (() => void) | undefined;
    const prepare = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const quit = vi.fn();
    const first = { preventDefault: vi.fn() };
    const second = { preventDefault: vi.fn() };
    const coordinator = new QuitCoordinator(prepare, quit);

    const prepared = coordinator.handle(first);
    coordinator.handle(second);

    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(second.preventDefault).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();

    finish?.();
    await prepared;
    expect(quit).toHaveBeenCalledOnce();

    const final = { preventDefault: vi.fn() };
    coordinator.handle(final);
    expect(final.preventDefault).not.toHaveBeenCalled();
  });
});
