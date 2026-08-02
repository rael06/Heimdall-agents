/**
 * The payload of a Windows toast.
 *
 * Kept apart from the process that shows it so the exact XML can be unit
 * tested: it is assembled from session titles and status reasons, which come
 * out of transcripts and contain ampersands, quotes and angle brackets often
 * enough that getting the escaping wrong would break the notification for
 * exactly the sessions worth being notified about.
 */

export interface ToastAction {
  label: string;
  uri: string;
}

export interface ToastContent {
  /** Workspace and provider: where this is happening. */
  heading: string;
  /** The session title. */
  title: string;
  /** What is being asked, so the toast can be acted on without opening it. */
  body: string;
  /** Where clicking the toast body sends the user. */
  launchUri: string;
  /**
   * A Windows sound event. Left out, the platform plays its default one, so
   * every notification sounds the same — which is a step down from three
   * distinct sounds telling you what happened before you look.
   */
  sound?: string;
  /**
   * Buttons, in order. Windows shows at most five and starts hiding text to fit
   * them, so two is the practical limit for a toast that still reads.
   */
  actions: ToastAction[];
}

/**
 * A sound per status, so what happened is audible before it is read — which is
 * what the hooks this replaced did with three separate wav files.
 *
 * Only the platform's own events can be named: an unpackaged application cannot
 * point a toast at a file of its own.
 */
const SOUND: Record<string, string> = {
  failed: 'ms-winsoundevent:Notification.SMS',
  // The one `completed` had, kept through the renaming: the status was given a
  // truer name, and nothing about the session changed, so nothing should change
  // to the ear either.
  idle: 'ms-winsoundevent:Notification.IM',
};

export function soundForStatus(status: string): string {
  return SOUND[status] ?? 'ms-winsoundevent:Notification.Default';
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * A toast carries only so much before Windows cuts it off, and a truncated
 * question is worse than a short one.
 */
export function clamp(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

export function toastXml(content: ToastContent): string {
  const text = (value: string, max: number): string => escapeXml(clamp(value, max));
  // `protocol` activation is the only kind available without registering a COM
  // server, so the button carries a URI and nothing else.
  return (
    `<toast activationType="protocol" launch="${escapeXml(content.launchUri)}">` +
    '<visual><binding template="ToastGeneric">' +
    `<text>${text(content.heading, 60)}</text>` +
    `<text>${text(content.title, 90)}</text>` +
    `<text placement="attribution">${text(content.body, 120)}</text>` +
    '</binding></visual>' +
    // Only the platform's own sound events are addressable here: a path to a
    // .wav is rejected unless the application is packaged with it as a
    // resource, which this one is not.
    (content.sound ? `<audio src="${escapeXml(content.sound)}"/>` : '') +
    '<actions>' +
    content.actions
      .map(
        (action) =>
          `<action content="${text(action.label, 30)}" activationType="protocol" ` +
          `arguments="${escapeXml(action.uri)}"/>`,
      )
      .join('') +
    '</actions>' +
    '</toast>'
  );
}
