/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export class RecordingBatchCompletions {
  private readonly pending = new Map<
    object,
    { resolve(): void; reject(error: unknown): void }
  >();
  // A batch can complete before its owner starts waiting, for example when a
  // concurrent flush drains it between publish and finalize.
  private readonly completed = new WeakSet<object>();

  waitFor(records: readonly object[]): Promise<void> {
    if (records.length === 0) return Promise.resolve();
    const lastRecord = records[records.length - 1];
    if (this.completed.has(lastRecord)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.pending.set(lastRecord, { resolve, reject });
    });
  }

  complete(records: readonly object[]): void {
    for (const record of records) {
      this.completed.add(record);
      this.pending.get(record)?.resolve();
      this.pending.delete(record);
    }
  }

  fail(error: unknown): void {
    for (const completion of this.pending.values()) completion.reject(error);
    this.pending.clear();
  }
}
