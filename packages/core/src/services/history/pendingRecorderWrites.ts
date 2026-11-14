/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Writes that a recorder runs on its own queue for the history, which the
 * history's mutation boundary must wait for. A failed write is kept and
 * thrown by the next {@link settle}, so nobody has to be waiting when it fails.
 */
export class PendingRecorderWrites {
  private readonly writes = new Set<Promise<void>>();
  private readonly failures: unknown[] = [];

  track(write: Promise<void>): void {
    const done: Promise<void> = write
      .catch((error: unknown) => {
        this.failures.push(error);
      })
      .finally(() => {
        this.writes.delete(done);
      });
    this.writes.add(done);
  }

  /** Resolves when every tracked write has finished; throws the failures of the finished ones. */
  async settle(): Promise<void> {
    while (this.writes.size > 0) await Promise.all([...this.writes]);
    const failed = this.failures.splice(0);
    if (failed.length === 1) throw failed[0];
    if (failed.length > 1) {
      throw new AggregateError(failed, 'Recorder writes failed');
    }
  }
}
