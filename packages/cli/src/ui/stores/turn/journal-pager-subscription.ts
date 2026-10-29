/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  subscribeJournalCommits,
  type JournalCommitWatermark,
} from '@vybestack/llxprt-code-core';

/** One refresh runs at a time; arrivals replace a scalar rather than queue reads. */
export class JournalPagerSubscription {
  private latest: JournalCommitWatermark | undefined;
  private running = false;
  private closed = false;
  private readonly unsubscribe: () => void;
  constructor(
    path: string,
    private readonly refresh: (
      watermark: JournalCommitWatermark,
    ) => Promise<void>,
    private readonly failed: (error: unknown) => void,
  ) {
    this.unsubscribe = subscribeJournalCommits(path, (watermark) => {
      this.latest = watermark;
      if (!this.running) void this.drain();
    });
  }
  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (!this.closed && this.latest !== undefined) {
        const watermark = this.latest;
        this.latest = undefined;
        await this.refresh(watermark);
      }
    } catch (error) {
      if (!this.closed) this.failed(error);
    } finally {
      this.running = false;
    }
  }
  close(): void {
    this.closed = true;
    this.latest = undefined;
    this.unsubscribe();
  }
}
