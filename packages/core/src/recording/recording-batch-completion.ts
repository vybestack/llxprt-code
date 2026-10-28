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

  waitFor(records: readonly object[]): Promise<void> {
    if (records.length === 0) return Promise.resolve();
    const lastRecord = records[records.length - 1];
    return new Promise<void>((resolve, reject) => {
      this.pending.set(lastRecord, { resolve, reject });
    });
  }

  complete(records: readonly object[]): void {
    for (const record of records) {
      this.pending.get(record)?.resolve();
      this.pending.delete(record);
    }
  }

  fail(error: unknown): void {
    for (const completion of this.pending.values()) completion.reject(error);
    this.pending.clear();
  }
}
