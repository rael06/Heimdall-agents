import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationQueue } from './notificationQueue';

describe('NotificationQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits before sending', () => {
    const send = vi.fn();
    const queue = new NotificationQueue(5000, send);
    queue.schedule('a');
    vi.advanceTimersByTime(4999);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledWith('a');
  });

  it('takes a new delay without being rebuilt', () => {
    // The whole reason this can be a setting rather than a command-line flag:
    // the queue is built once and lives as long as the service does.
    const send = vi.fn();
    const queue = new NotificationQueue(5000, send);
    queue.delay = 1000;
    queue.schedule('a');
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledWith('a');
  });

  it('leaves a wait already running on its original delay', () => {
    // The same rule `schedule` states: what is measured is a quiet period since
    // the session stopped, and rewriting a running timer would restart it from
    // a moment that has nothing to do with the session.
    const send = vi.fn();
    const queue = new NotificationQueue(5000, send);
    queue.schedule('a');
    queue.delay = 60_000;
    vi.advanceTimersByTime(5000);
    expect(send).toHaveBeenCalledWith('a');
  });

  it('says nothing about a session that started working again', () => {
    // The case the wait exists for: a turn that ends and resumes at once.
    const send = vi.fn();
    const queue = new NotificationQueue(5000, send);
    queue.schedule('a');
    vi.advanceTimersByTime(2000);
    queue.retain(new Set());
    vi.advanceTimersByTime(10000);
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps waiting for a session that still qualifies', () => {
    const send = vi.fn();
    const queue = new NotificationQueue(5000, send);
    queue.schedule('a');
    queue.schedule('b');
    vi.advanceTimersByTime(2000);
    queue.retain(new Set(['a']));
    vi.advanceTimersByTime(5000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('a');
  });

  it('does not restart the wait on every scan', () => {
    // Otherwise a session scanned every second would never reach its delay.
    const send = vi.fn();
    const queue = new NotificationQueue(5000, send);
    queue.schedule('a');
    for (let elapsed = 0; elapsed < 5000; elapsed += 1000) {
      vi.advanceTimersByTime(1000);
      queue.schedule('a');
    }
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('forgets what it was holding when cleared', () => {
    const send = vi.fn();
    const queue = new NotificationQueue(5000, send);
    queue.schedule('a');
    expect(queue.pending).toEqual(['a']);
    queue.clear();
    vi.advanceTimersByTime(10000);
    expect(send).not.toHaveBeenCalled();
    expect(queue.pending).toEqual([]);
  });

  it('can be waiting on several sessions at once', () => {
    const send = vi.fn();
    const queue = new NotificationQueue(5000, send);
    queue.schedule('a');
    vi.advanceTimersByTime(3000);
    queue.schedule('b');
    vi.advanceTimersByTime(2000);
    expect(send).toHaveBeenCalledWith('a');
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(send).toHaveBeenCalledWith('b');
  });
});
