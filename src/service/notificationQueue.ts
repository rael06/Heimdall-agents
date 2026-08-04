/**
 * Holds a notification back until the session has genuinely stopped.
 *
 * Notifying on the transition itself is fragile. A turn can end and resume
 * within a second — a stop hook that re-enters, a sub-agent handing back, a
 * tool starting again — and the transcript says nothing about which it is until
 * a moment has passed. Firing immediately means telling you a session finished
 * while it is still working.
 *
 * So a decision to notify is scheduled rather than sent, and cancelled if the
 * session stops qualifying before the delay is up. What survives the wait had
 * really stopped.
 */
export class NotificationQueue {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private delayMs: number,
    private readonly send: (id: string) => void,
  ) {}

  get pending(): string[] {
    return [...this.timers.keys()];
  }

  /**
   * Changes what the next wait will be, and leaves the waits already running.
   *
   * The same rule `schedule` states below, for the same reason: what is being
   * measured is a quiet period since the session stopped, and rewriting a timer
   * that is already counting would restart that period from a moment which has
   * nothing to do with the session. A setting changed mid-wait applies to the
   * next one.
   */
  set delay(ms: number) {
    this.delayMs = ms;
  }

  /**
   * Starts the wait. A session already waiting keeps its original timer: the
   * point is a quiet period since it stopped, not one restarted by every scan.
   */
  schedule(id: string): void {
    if (this.timers.has(id)) {
      return;
    }
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        this.send(id);
      }, this.delayMs),
    );
  }

  cancel(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  /** Drops whatever no longer qualifies — a session that started working again. */
  retain(eligible: ReadonlySet<string>): void {
    for (const id of this.timers.keys()) {
      if (!eligible.has(id)) {
        this.cancel(id);
      }
    }
  }

  clear(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
