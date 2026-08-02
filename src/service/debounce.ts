/**
 * Collapses a burst of filesystem events into one call.
 *
 * A plain debounce is not enough here. A session mid-turn writes to its
 * transcript every few hundred milliseconds, for minutes: a timer restarted on
 * every event would never fire, and the running session — the one worth
 * watching — would be the one never reported. `maxWaitMs` bounds that: however
 * long the burst lasts, the callback runs at least that often.
 */
export class Debouncer {
  private quiet?: ReturnType<typeof setTimeout>;
  private ceiling?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly run: () => void,
    private readonly waitMs: number,
    private readonly maxWaitMs: number,
  ) {}

  get pending(): boolean {
    return this.quiet !== undefined;
  }

  trigger(): void {
    if (this.quiet) {
      clearTimeout(this.quiet);
    } else {
      // First event of a burst: from here, the callback runs within maxWaitMs
      // whatever happens next.
      this.ceiling = setTimeout(() => this.fire(), this.maxWaitMs);
    }
    this.quiet = setTimeout(() => this.fire(), this.waitMs);
  }

  cancel(): void {
    if (this.quiet) {
      clearTimeout(this.quiet);
      this.quiet = undefined;
    }
    if (this.ceiling) {
      clearTimeout(this.ceiling);
      this.ceiling = undefined;
    }
  }

  private fire(): void {
    this.cancel();
    this.run();
  }
}
