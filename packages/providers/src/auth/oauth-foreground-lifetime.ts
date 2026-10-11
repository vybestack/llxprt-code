/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export class OAuthForegroundLifetime {
  private readonly controller = new AbortController();
  private readonly pending = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;

  accept<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.controller.signal.aborted)
      return Promise.reject(new Error('OAuth manager is disposed'));
    const pending = Promise.resolve().then(() => {
      this.controller.signal.throwIfAborted();
      return operation(this.controller.signal);
    });
    this.pending.add(pending);
    void pending.then(
      () => this.pending.delete(pending),
      () => this.pending.delete(pending),
    );
    return pending;
  }

  dispose(retireRenewals: () => Promise<void>): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.controller.abort(new Error('OAuth manager is disposed'));
    const work = [...this.pending, Promise.resolve().then(retireRenewals)];
    this.closing = Promise.allSettled(work).then((results) => {
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failures.length > 0)
        throw new AggregateError(failures, 'OAuth retirement failed');
    });
    return this.closing;
  }
}
