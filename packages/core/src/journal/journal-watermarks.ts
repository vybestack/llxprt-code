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
const subscriptions = new Map<string, Set<Subscription>>();
let generation = 0;

/** Coalesces a slow subscriber to one scalar watermark, never a payload queue. */
export function subscribeJournalCommits(
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
  const listeners = subscriptions.get(key) ?? new Set<Subscription>();
  listeners.add(subscription);
  subscriptions.set(key, listeners);
  return () => {
    active = false;
    latest = undefined;
    listeners.delete(subscription);
    if (listeners.size === 0) subscriptions.delete(key);
  };
}

export function journalCommitPublisher(
  path: string,
): (ack: CommitAck, swapped?: boolean) => void {
  const key = resolve(path);
  let sessionGeneration = ++generation;
  return (ack, swapped = false) => {
    if (swapped) sessionGeneration = ++generation;
    const watermark: JournalCommitWatermark = {
      ...ack,
      sessionGeneration,
      invalidate: true,
    };
    for (const listener of subscriptions.get(key) ?? [])
      listener.deliver(watermark);
  };
}
