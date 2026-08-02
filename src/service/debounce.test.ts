import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Debouncer } from './debounce';

describe('Debouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits for the quiet period before running', () => {
    const run = vi.fn();
    const debouncer = new Debouncer(run, 200, 2000);
    debouncer.trigger();
    vi.advanceTimersByTime(199);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst into a single call', () => {
    const run = vi.fn();
    const debouncer = new Debouncer(run, 200, 2000);
    for (let i = 0; i < 5; i += 1) {
      debouncer.trigger();
      vi.advanceTimersByTime(50);
    }
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs anyway once the ceiling is reached, so a session writing without pause is still reported', () => {
    const run = vi.fn();
    const debouncer = new Debouncer(run, 200, 1000);
    // A turn in progress: an event every 100 ms, never a 200 ms gap.
    for (let elapsed = 0; elapsed < 1000; elapsed += 100) {
      debouncer.trigger();
      vi.advanceTimersByTime(100);
    }
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('starts a new burst after it fired', () => {
    const run = vi.fn();
    const debouncer = new Debouncer(run, 200, 1000);
    debouncer.trigger();
    vi.advanceTimersByTime(200);
    debouncer.trigger();
    vi.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('forgets a pending burst when cancelled', () => {
    const run = vi.fn();
    const debouncer = new Debouncer(run, 200, 1000);
    debouncer.trigger();
    expect(debouncer.pending).toBe(true);
    debouncer.cancel();
    vi.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();
    expect(debouncer.pending).toBe(false);
  });
});
