/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  combineMutationFailures,
  type MutationFailure,
} from './historyMutationFailure.js';

/**
 * Clears that were queued under the compression lock, and the failures they
 * ended with (WIRING G4, #2852 never-drop contract). A store that clears
 * asynchronously cannot throw from the synchronous flush that starts the
 * clear, so a failure reaches the caller's `clear()` promise and is also held
 * here until `settle` reports it, once, to whoever waits for pending work.
 */
export class QueuedClearFailures {
  private readonly running = new Set<Promise<void>>();
  private failure: MutationFailure = { failed: false };

  /** Follows a clear the service started from its compression queue. */
  track(cleared: Promise<void>): void {
    const tracked: Promise<void> = cleared
      .then(
        () => undefined,
        (error: unknown) => {
          this.failure = combineMutationFailures(this.failure, {
            failed: true,
            error,
          });
        },
      )
      .then(() => {
        this.running.delete(tracked);
      });
    this.running.add(tracked);
  }

  /** Waits for the tracked clears, then throws the failures they ended with and forgets them. */
  async settle(): Promise<void> {
    await Promise.all(this.running);
    const failure = this.failure;
    this.failure = { failed: false };
    if (failure.failed) throw failure.error;
  }
}
