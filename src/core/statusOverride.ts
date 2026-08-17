import { SessionStatus } from '../model/types';

/**
 * A status you set by hand, over the one the transcript implies.
 *
 * The list exists to say what the files say, so a status asserted rather than
 * observed is a different kind of claim and must never be indistinguishable
 * from the other kind. Two things keep that true, and they are the whole design:
 *
 * The row says so. An overridden status carries its own reason — who set it and
 * when — instead of the inferred one, and the cell is marked, because a state
 * you cannot see is a state you end up fighting.
 *
 * And it does not outlive the evidence it was set against. `inferred` records
 * what the transcript said at the moment you disagreed with it; the moment the
 * transcript says something else, your correction has been overtaken by events
 * and is dropped. Otherwise a session marked *idle* that went back to work
 * would keep saying *idle*, which is the one thing this table must not do.
 */
export interface StatusOverride {
  /** What to show instead. */
  status: SessionStatus;
  /** What the transcript said when it was set, and what releases it. */
  inferred: SessionStatus;
  /** When it was set (ISO), shown in the reason. */
  at: string;
}

export type StatusOverrides = Readonly<Record<string, StatusOverride>>;

/**
 * Splits the overrides into those the evidence still supports and those it has
 * overtaken.
 *
 * A session that has since disappeared keeps its entry: it may be outside the
 * history window rather than gone, and dropping it would silently lose a
 * correction for a session that comes back.
 */
export function releaseOvertaken(
  overrides: StatusOverrides,
  inferredById: ReadonlyMap<string, SessionStatus>,
): { kept: Record<string, StatusOverride>; released: string[] } {
  const kept: Record<string, StatusOverride> = {};
  const released: string[] = [];
  for (const [id, override] of Object.entries(overrides)) {
    const inferred = inferredById.get(id);
    if (inferred !== undefined && inferred !== override.inferred) {
      released.push(id);
    } else {
      kept[id] = override;
    }
  }
  return { kept, released };
}

/** The sentence the row shows in place of the inferred one. */
export function overrideReason(override: StatusOverride, inferredReason: string): string {
  return `Set by you — the transcript says ${override.inferred}: ${inferredReason}`;
}
