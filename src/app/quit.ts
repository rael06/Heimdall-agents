/** The one operation an application event must offer to hold a quit open. */
export interface PreventableQuit {
  preventDefault(): void;
}

/**
 * Turns Electron's synchronous `before-quit` gate into one asynchronous close.
 *
 * Every request is prevented until preparation has settled, but preparation is
 * started only once. The final `quit` comes back through the same event after
 * the gate has opened, so Electron still closes its windows in its usual order.
 */
export class QuitCoordinator {
  private prepared = false;
  private preparing: Promise<void> | undefined;

  constructor(
    private readonly prepare: () => Promise<void>,
    private readonly quit: () => void,
  ) {}

  handle(event: PreventableQuit): Promise<void> | undefined {
    if (this.prepared) return undefined;

    event.preventDefault();
    this.preparing ??= this.prepare()
      // A failure must not leave an application that can never be closed. The
      // renderer and service have already had their one orderly chance here.
      .catch(() => undefined)
      .then(() => {
        this.prepared = true;
        this.quit();
      });
    return this.preparing;
  }
}
