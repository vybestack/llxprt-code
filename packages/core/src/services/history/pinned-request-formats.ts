/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { PrepareNativeRequestFormat } from './native-provider-format.js';
import { hasNativeRequestFormat } from './native-provider-format.js';

export class PinnedRequestFormats {
  private measured: VersionSnapshot | undefined;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private holds = 1;

  constructor(
    private readonly source: VersionSnapshot,
    private readonly fill: PrepareNativeRequestFormat,
  ) {}

  readonly prepare: PrepareNativeRequestFormat = (_snapshot, registration) => {
    const turn = this.queue.then(async () => {
      if (this.closed) throw new Error('Pinned request formats are closed');
      let selected = this.measured ?? this.source;
      if (!hasNativeRequestFormat(selected, registration)) {
        const next = await this.fill(selected, registration);
        const previous = this.measured;
        this.measured = next;
        selected = next;
        await previous?.close();
      }
      return selected.retain();
    });
    this.queue = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  };

  hold(): () => Promise<void> {
    if (this.closed) throw new Error('Pinned request formats are closed');
    this.holds++;
    return () => this.release();
  }

  close(): Promise<void> {
    return this.release();
  }

  private async release(): Promise<void> {
    if (--this.holds !== 0) return;
    this.closed = true;
    await this.queue;
    await this.measured?.close();
  }
}
