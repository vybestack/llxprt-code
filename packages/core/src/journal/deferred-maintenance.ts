/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { setImmediate } from 'node:timers/promises';

export class JournalMaintenanceScope {
  private requests = 0;
  private readonly active = new Set<Promise<void>>();
  private readonly deferred = new Set<DeferredMaintenance>();
  private parent: JournalMaintenanceScope | undefined;

  private owner(): JournalMaintenanceScope {
    if (this.parent === undefined) return this;
    this.parent = this.parent.owner();
    return this.parent;
  }

  async join(other: JournalMaintenanceScope): Promise<void> {
    const owner = this.owner();
    const incoming = other.owner();
    if (owner === incoming) return;
    owner.requests += incoming.requests;
    for (const running of incoming.active) owner.active.add(running);
    for (const waiting of incoming.deferred) owner.deferred.add(waiting);
    incoming.requests = 0;
    incoming.active.clear();
    incoming.deferred.clear();
    incoming.parent = owner;
    if (owner.requests > 0) await owner.drain();
  }

  private async drain(): Promise<void> {
    while (this.owner().active.size > 0) await Promise.all(this.owner().active);
  }

  async suspend(): Promise<() => void> {
    this.owner().requests++;
    await this.drain();
    let released = false;
    return () => {
      if (released) throw new Error('Journal maintenance scope released twice');
      released = true;
      const owner = this.owner();
      owner.requests--;
      if (owner.requests !== 0) return;
      const waiting = [...owner.deferred];
      owner.deferred.clear();
      for (const maintenance of waiting) maintenance.request();
    };
  }

  defer(maintenance: DeferredMaintenance): boolean {
    const owner = this.owner();
    if (owner.requests === 0) return false;
    owner.deferred.add(maintenance);
    return true;
  }

  async run(work: () => Promise<void>): Promise<void> {
    const running = work();
    this.owner().active.add(running);
    try {
      await running;
    } finally {
      this.owner().active.delete(running);
    }
  }
}

/** Sends own the writer before synchronous admissions; idle copies drain first. */
export function suspendJournalMaintenance(
  scope: JournalMaintenanceScope,
): Promise<() => void> {
  return scope.suspend();
}

export class DeferredMaintenance {
  private scheduled: Promise<void> | undefined;
  private requested = false;

  constructor(
    private readonly scope: JournalMaintenanceScope,
    private readonly run: () => Promise<void>,
    private readonly fail: (error: unknown) => void,
  ) {}

  request(): void {
    this.requested = true;
    if (this.scope.defer(this)) return;
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
    if (this.scope.defer(this)) return;
    this.requested = false;
    await this.scope.run(() =>
      this.run().catch((error: unknown) => this.fail(error)),
    );
  }

  consumeRequests(): void {
    this.requested = false;
  }

  async settle(): Promise<void> {
    while (this.scheduled !== undefined) await this.scheduled;
  }
}
