/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { resolve } from 'node:path';
import type { CommitAck } from './groupWriter.js';

export interface JournalCommitWatermark extends CommitAck {
  readonly sessionGeneration: number;
  readonly invalidate: true;
}
interface Subscription {
  deliver(watermark: JournalCommitWatermark): void;
}
export class JournalWatermarks {
  private readonly subscriptions = new Map<string, Set<Subscription>>();
  private generation = 0;

  /** Coalesces a slow subscriber to one scalar watermark, never a payload queue. */
  subscribe(
    path: string,
    listener: (watermark: JournalCommitWatermark) => void,
  ): () => void {
    const key = resolve(path);
    let active = true;
    let scheduled = false;
    let latest: JournalCommitWatermark | undefined;
    const subscription: Subscription = {
      deliver(watermark) {
        latest = watermark;
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          if (active && latest !== undefined) listener(latest);
        });
      },
    };
    const listeners = this.subscriptions.get(key) ?? new Set<Subscription>();
    listeners.add(subscription);
    this.subscriptions.set(key, listeners);
    return () => {
      active = false;
      latest = undefined;
      listeners.delete(subscription);
      if (listeners.size === 0) this.subscriptions.delete(key);
    };
  }

  publisher(path: string): (ack: CommitAck, swapped?: boolean) => void {
    const key = resolve(path);
    let sessionGeneration = ++this.generation;
    return (ack, swapped = false) => {
      if (swapped) sessionGeneration = ++this.generation;
      const watermark: JournalCommitWatermark = {
        ...ack,
        sessionGeneration,
        invalidate: true,
      };
      for (const listener of this.subscriptions.get(key) ?? [])
        listener.deliver(watermark);
    };
  }
}

export function subscribeJournalCommits(
  path: string,
  listener: (watermark: JournalCommitWatermark) => void,
  watermarks: Pick<JournalWatermarks, 'subscribe'>,
): () => void {
  return watermarks.subscribe(path, listener);
}

export function journalCommitPublisher(
  path: string,
  watermarks: JournalWatermarks,
): (ack: CommitAck, swapped?: boolean) => void {
  return watermarks.publisher(path);
}
