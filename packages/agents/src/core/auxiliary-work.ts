/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export class AuxiliaryWork {
  private readonly cancellation = new AbortController();
  private readonly accepted = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;

  async run<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    caller?: AbortSignal,
  ): Promise<T> {
    if (this.cancellation.signal.aborted)
      throw new Error('Auxiliary generation is closed');
    const signal =
      caller === undefined
        ? this.cancellation.signal
        : AbortSignal.any([caller, this.cancellation.signal]);
    signal.throwIfAborted();
    const pending = operation(signal);
    this.accepted.add(pending);
    try {
      return await pending;
    } finally {
      this.accepted.delete(pending);
    }
  }

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.cancellation.abort();
    this.closing = Promise.allSettled([...this.accepted]).then(() => undefined);
    return this.closing;
  }
}
