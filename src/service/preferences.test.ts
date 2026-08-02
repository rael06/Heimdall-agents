import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTIFICATIONS, sanitizePreferences } from './preferences';

const fallback = DEFAULT_NOTIFICATIONS;

describe('sanitizePreferences', () => {
  it('reads back a complete file', () => {
    const stored = {
      version: 1,
      notifications: { enabled: false, on: ['idle'], scope: 'unacknowledged' },
    };
    expect(sanitizePreferences(stored, fallback).notifications).toEqual({
      enabled: false,
      on: ['idle'],
      scope: 'unacknowledged',
    });
  });

  it('falls back to what the command line asked for, field by field', () => {
    expect(sanitizePreferences({ notifications: { enabled: false } }, fallback).notifications).toEqual(
      { enabled: false, on: fallback.on, scope: fallback.scope },
    );
  });

  it('keeps an empty list, because notifying about nothing is a choice', () => {
    // Not the same as never having chosen, which is what the fallback covers.
    expect(sanitizePreferences({ notifications: { on: [] } }, fallback).notifications.on).toEqual([]);
  });

  it('drops a status it does not know rather than carrying it', () => {
    expect(
      sanitizePreferences({ notifications: { on: ['idle', 'exploded'] } }, fallback)
        .notifications.on,
    ).toEqual(['idle']);
  });

  it('carries a file written before the renaming', () => {
    // Dropping these would silently empty the list of someone who had asked to
    // be told, which is worse than a setting that was never offered.
    expect(
      sanitizePreferences({ notifications: { on: ['completed'] } }, fallback).notifications.on,
    ).toEqual(['idle']);
    expect(
      sanitizePreferences({ notifications: { on: ['needs-action'] } }, fallback).notifications.on,
    ).toEqual(['idle']);
  });

  it('drops a status that never means the model stopped working, once', () => {
    // An open turn going silent is a fact about a stale file. Waking someone for
    // it is the kind of alert that teaches people to ignore the channel.
    expect(
      sanitizePreferences({ version: 1, notifications: { on: ['idle', 'unknown'] } }, fallback)
        .notifications.on,
    ).toEqual(['idle']);
  });

  it('leaves that choice alone once it has been made deliberately', () => {
    // Otherwise the chip un-ticks itself at every start, which is a setting that
    // pretends to save.
    expect(
      sanitizePreferences({ version: 2, notifications: { on: ['idle', 'unknown'] } }, fallback)
        .notifications.on,
    ).toEqual(['idle', 'unknown']);
  });

  it('does not list the same status twice when both old names were stored', () => {
    expect(
      sanitizePreferences(
        { notifications: { on: ['needs-action', 'completed', 'failed'] } },
        fallback,
      ).notifications.on,
    ).toEqual(['failed', 'idle']);
  });

  it('refuses a scope it does not know', () => {
    expect(
      sanitizePreferences({ notifications: { scope: 'everything' } }, fallback).notifications.scope,
    ).toBe(fallback.scope);
  });

  it('survives a file that is not what it should be', () => {
    expect(sanitizePreferences(null, fallback).notifications).toEqual(fallback);
    expect(sanitizePreferences({ notifications: 'yes' }, fallback).notifications).toEqual(fallback);
  });
});
