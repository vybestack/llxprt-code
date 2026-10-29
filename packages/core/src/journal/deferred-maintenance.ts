/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { setImmediate } from 'node:timers/promises';

// Recorder mirrors and admission journals also create files, so request idle
// applies across journals rather than only to the source snapshot's pin.
let requests = 0;
const active = new Set<Promise<void>>();
const deferred = new Set<DeferredMaintenance>();

/** Sends own the writer before synchronous admissions; idle copies drain first. */
export async function suspendJournalMaintenance(): Promise<() => void> {
  requests++;
  await Promise.all(active);
  let released = false;
  return () => {
    if (released) throw new Error('Journal maintenance scope released twice');
    released = true;
    requests--;
    if (requests !== 0) return;
    const waiting = [...deferred];
    deferred.clear();
    for (const maintenance of waiting) maintenance.request();
  };
}

export class DeferredMaintenance {
  private scheduled: Promise<void> | undefined;
  private requested = false;

  constructor(
    private readonly run: () => Promise<void>,
    private readonly fail: (error: unknown) => void,
  ) {}

  request(): void {
    this.requested = true;
    if (requests > 0) {
      deferred.add(this);
      return;
    }
    if (this.scheduled !== undefined) return;
    this.scheduled = setImmediate()
      .then(() => this.start())
      .catch((error: unknown) => this.fail(error))
      .finally(() => {
        this.scheduled = undefined;
        if (this.requested) this.request();
      });
  }

  private async start(): Promise<void> {
    if (requests > 0) {
      deferred.add(this);
      return;
    }
    this.requested = false;
    const running = this.run().catch((error: unknown) => this.fail(error));
    active.add(running);
    try {
      await running;
    } finally {
      active.delete(running);
    }
  }

  consumeRequests(): void {
    this.requested = false;
  }

  async settle(): Promise<void> {
    while (this.scheduled !== undefined) await this.scheduled;
  }
}
