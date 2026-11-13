/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  DeferredMaintenance,
  JournalMaintenanceScope,
  suspendJournalMaintenance,
} from './deferred-maintenance.js';

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function fail(error: unknown): never {
  throw error;
}

describe('deferred journal maintenance', () => {
  it('keeps unrelated histories independent', async () => {
    const suspended = new JournalMaintenanceScope();
    const independent = new JournalMaintenanceScope();
    const release = await suspendJournalMaintenance(suspended);
    let runs = 0;
    const maintenance = new DeferredMaintenance(
      independent,
      async () => {
        runs++;
      },
      fail,
    );
    try {
      maintenance.request();
      await maintenance.settle();
      expect(runs).toBe(1);
    } finally {
      release();
    }
  });

  it('shares overlapping requests with a journal attached after suspension', async () => {
    const primary = new JournalMaintenanceScope();
    const mirror = new JournalMaintenanceScope();
    const releasePrimary = await suspendJournalMaintenance(primary);
    const releaseMirror = await suspendJournalMaintenance(mirror);
    await primary.join(mirror);
    let runs = 0;
    const maintenance = new DeferredMaintenance(
      mirror,
      async () => {
        runs++;
      },
      fail,
    );
    maintenance.request();
    releasePrimary();
    await maintenance.settle();
    expect(runs).toBe(0);
    releaseMirror();
    await maintenance.settle();
    expect(runs).toBe(1);
  });

  it('drains active maintenance when an existing journal joins a suspended history', async () => {
    const primary = new JournalMaintenanceScope();
    const mirror = new JournalMaintenanceScope();
    const entered = gate();
    const finish = gate();
    let runs = 0;
    const maintenance = new DeferredMaintenance(
      mirror,
      async () => {
        entered.release();
        await finish.promise;
        runs++;
      },
      fail,
    );
    maintenance.request();
    await entered.promise;
    const release = await suspendJournalMaintenance(primary);
    let joined = false;
    const joining = primary.join(mirror).then(() => {
      joined = true;
    });
    await Promise.resolve();
    expect(joined).toBe(false);
    finish.release();
    await joining;
    maintenance.request();
    await maintenance.settle();
    expect(runs).toBe(1);
    release();
    await maintenance.settle();
    expect(runs).toBe(2);
  });
  it('drains active maintenance and defers every journal until the request closes', async () => {
    const scope = new JournalMaintenanceScope();
    const entered = gate();
    const resume = gate();
    const events: string[] = [];
    const first = new DeferredMaintenance(
      scope,
      async () => {
        entered.release();
        await resume.promise;
        events.push('first');
      },
      fail,
    );
    const second = new DeferredMaintenance(
      scope,
      async () => {
        events.push('second');
      },
      fail,
    );
    first.request();
    await entered.promise;
    let acquired = false;
    const acquiring = suspendJournalMaintenance(scope).then((release) => {
      acquired = true;
      return release;
    });
    second.request();
    await second.settle();
    expect(acquired).toBe(false);
    expect(events).toStrictEqual([]);
    resume.release();
    const release = await acquiring;
    try {
      second.request();
      await second.settle();
      expect(events).toStrictEqual(['first']);
    } finally {
      release();
    }
    await second.settle();
    expect(events).toStrictEqual(['first', 'second']);
  });

  it('keeps maintenance deferred until the last overlapping request closes', async () => {
    const scope = new JournalMaintenanceScope();
    let runs = 0;
    const maintenance = new DeferredMaintenance(
      scope,
      async () => {
        runs++;
      },
      fail,
    );
    const releaseFirst = await suspendJournalMaintenance(scope);
    const releaseSecond = await suspendJournalMaintenance(scope);
    maintenance.request();
    releaseFirst();
    await maintenance.settle();
    expect(runs).toBe(0);
    releaseSecond();
    await maintenance.settle();
    expect(runs).toBe(1);
  });

  it('coalesces requests without entering maintenance in the current turn', async () => {
    const scope = new JournalMaintenanceScope();
    let runs = 0;
    const maintenance = new DeferredMaintenance(
      scope,
      async () => {
        runs++;
      },
      fail,
    );
    maintenance.request();
    maintenance.request();
    await Promise.resolve();
    expect(runs).toBe(0);
    await maintenance.settle();
    expect(runs).toBe(1);
  });

  it('settles requests received while maintenance is running', async () => {
    const scope = new JournalMaintenanceScope();
    const entered = gate();
    const resume = gate();
    let runs = 0;
    const maintenance = new DeferredMaintenance(
      scope,
      async () => {
        runs++;
        entered.release();
        await resume.promise;
      },
      fail,
    );
    maintenance.request();
    await entered.promise;
    maintenance.request();
    resume.release();
    await maintenance.settle();
    expect(runs).toBe(2);
  });

  it('does not repeat work that consumed requests queued before it began', async () => {
    const scope = new JournalMaintenanceScope();
    const entered = gate();
    const resume = gate();
    let runs = 0;
    const maintenance = new DeferredMaintenance(
      scope,
      async () => {
        entered.release();
        await resume.promise;
        maintenance.consumeRequests();
        runs++;
      },
      fail,
    );
    maintenance.request();
    await entered.promise;
    maintenance.request();
    resume.release();
    await maintenance.settle();
    expect(runs).toBe(1);
  });

  it('reports an asynchronous maintenance failure to its owner', async () => {
    const scope = new JournalMaintenanceScope();
    const failure = new Error('candidate copy failed');
    const failures: unknown[] = [];
    const maintenance = new DeferredMaintenance(
      scope,
      async () => {
        throw failure;
      },
      (error) => {
        failures.push(error);
      },
    );
    maintenance.request();
    await maintenance.settle();
    expect(failures).toStrictEqual([failure]);
  });
});
