/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export class OAuthForegroundLifetime {
  private readonly controller = new AbortController();
  private readonly pending = new Set<Promise<unknown>>();

  accept<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.controller.signal.aborted)
      return Promise.reject(new Error('OAuth manager is disposed'));
    // The operation starts synchronously: callers that join a shared
    // authentication flight must do so in the order they were made.
    const pending = (async () => operation(this.controller.signal))();
    this.pending.add(pending);
    void pending.then(
      () => this.pending.delete(pending),
      () => this.pending.delete(pending),
    );
    return pending;
  }

  /** Closes admission and aborts the owner signal; later `accept` calls reject. */
  close(): void {
    if (!this.controller.signal.aborted)
      this.controller.abort(new Error('OAuth manager is disposed'));
  }

  /**
   * Waits for every accepted operation to settle. Their outcomes belong to
   * their callers, and aborts that `close` caused are not reported again.
   */
  async join(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }
}
