/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalStore } from './journalStore.js';
import type { VersionSnapshot } from './versionSnapshot.js';

export class MirrorCheckpoint {
  private constructor(
    readonly versions: ReadonlyMap<JournalStore, VersionSnapshot>,
  ) {}

  static async capture(
    mirrors: ReadonlyArray<{
      readonly store: JournalStore;
      readonly queue: Promise<void>;
    }>,
  ): Promise<MirrorCheckpoint> {
    const versions = new Map<JournalStore, VersionSnapshot>();
    const checkpoint = new MirrorCheckpoint(versions);
    try {
      for (const mirror of mirrors) {
        await mirror.queue;
        versions.set(mirror.store, await mirror.store.snapshot());
      }
      return checkpoint;
    } catch (error) {
      try {
        await checkpoint.close();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'Mirror checkpoint failed');
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.versions.values()].map((snapshot) => snapshot.close()),
    );
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'Mirror checkpoint cleanup failed');
  }
}
