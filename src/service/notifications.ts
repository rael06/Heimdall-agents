import { SessionStatus } from '../model/types';
import { Transition } from './transitions';

/**
 * What deserves a notification, and what does not.
 *
 * The rules are deliberately mean. A notification that fires when nothing is
 * blocked teaches you to ignore the channel, and once muted it never comes
 * back — so this errs towards saying nothing.
 */

/**
 * The model stopping work, which is the whole promise of this application.
 *
 * There is one event worth a sound: the session was working and now it is not.
 * Whether it finished, stopped to ask you something or hit an error, the next
 * move is yours — and that is the same sentence on every provider, because it
 * is the only thing all of them actually write down.
 */
export const DEFAULT_NOTIFY_ON: SessionStatus[] = ['idle', 'failed'];

/**
 * Which sessions may raise a notification at all.
 *
 * `watched` follows the eye: only sessions you are following, and dismissing one
 * silences it until it works again. It is narrow by design, and it has a gap —
 * a session is only watched automatically when it is seen *starting* to run, so
 * one that was already running before the service came up never qualifies.
 *
 * `unacknowledged` follows the marker instead: anything that stopped with
 * something you have not seen. Acknowledging becomes the way to silence a
 * session, rather than un-watching it.
 */
export type NotifyScope = 'watched' | 'unacknowledged';

export const NOTIFY_SCOPES: NotifyScope[] = ['watched', 'unacknowledged'];

export const DEFAULT_NOTIFY_SCOPE: NotifyScope = 'watched';

export interface NotifyPolicy {
  enabled: boolean;
  /** Statuses a session must enter for a notification to go out. */
  on: ReadonlySet<SessionStatus>;
  scope: NotifyScope;
}

export interface NotifyInput {
  transitions: readonly Transition[];
  /** Sessions being followed. */
  watched: ReadonlySet<string>;
  /**
   * Sessions holding something unseen, *after* this scan applied its changes —
   * a session that just stopped is already in here, which is what makes it
   * usable as the trigger for the very transition that put it there.
   */
  unacknowledged: ReadonlySet<string>;
  /** Sessions already notified in their current turn. */
  notified: ReadonlySet<string>;
  policy: NotifyPolicy;
}

export interface NotifyDecision {
  /** Sessions to notify about, in the order they changed. */
  notify: string[];
  /** The new set of sessions already notified in their current turn. */
  notified: Set<string>;
}

export function chooseNotifications(input: NotifyInput): NotifyDecision {
  const notified = new Set(input.notified);
  const notify: string[] = [];

  for (const transition of input.transitions) {
    // A session seen for the first time is not an event: on a cold start that
    // would notify for the whole history at once.
    if (transition.from === undefined || transition.from === transition.to) {
      continue;
    }
    if (transition.to === 'running') {
      // A new turn begins, so the session may be notified about again when it
      // ends. This is what "at most one per turn" means.
      notified.delete(transition.id);
      continue;
    }
    if (!input.policy.enabled || !input.policy.on.has(transition.to)) {
      continue;
    }
    const allowed =
      input.policy.scope === 'unacknowledged'
        ? input.unacknowledged.has(transition.id)
        : input.watched.has(transition.id);
    if (!allowed || notified.has(transition.id)) {
      continue;
    }
    notified.add(transition.id);
    notify.push(transition.id);
  }

  return { notify, notified };
}
