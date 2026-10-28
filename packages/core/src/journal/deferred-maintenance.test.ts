/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  DeferredMaintenance,
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
  it('drains active maintenance and defers every journal until the request closes', async () => {
    const entered = gate();
    const resume = gate();
    const events: string[] = [];
    const first = new DeferredMaintenance(async () => {
      entered.release();
      await resume.promise;
      events.push('first');
    }, fail);
    const second = new DeferredMaintenance(async () => {
      events.push('second');
    }, fail);
    first.request();
    await entered.promise;
    let acquired = false;
    const acquiring = suspendJournalMaintenance().then((release) => {
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
    let runs = 0;
    const maintenance = new DeferredMaintenance(async () => {
      runs++;
    }, fail);
    const releaseFirst = await suspendJournalMaintenance();
    const releaseSecond = await suspendJournalMaintenance();
    maintenance.request();
    releaseFirst();
    await maintenance.settle();
    expect(runs).toBe(0);
    releaseSecond();
    await maintenance.settle();
    expect(runs).toBe(1);
  });

  it('coalesces requests without entering maintenance in the current turn', async () => {
    let runs = 0;
    const maintenance = new DeferredMaintenance(async () => {
      runs++;
    }, fail);
    maintenance.request();
    maintenance.request();
    await Promise.resolve();
    expect(runs).toBe(0);
    await maintenance.settle();
    expect(runs).toBe(1);
  });

  it('settles requests received while maintenance is running', async () => {
    const entered = gate();
    const resume = gate();
    let runs = 0;
    const maintenance = new DeferredMaintenance(async () => {
      runs++;
      entered.release();
      await resume.promise;
    }, fail);
    maintenance.request();
    await entered.promise;
    maintenance.request();
    resume.release();
    await maintenance.settle();
    expect(runs).toBe(2);
  });

  it('does not repeat work that consumed requests queued before it began', async () => {
    const entered = gate();
    const resume = gate();
    let runs = 0;
    const maintenance = new DeferredMaintenance(async () => {
      entered.release();
      await resume.promise;
      maintenance.consumeRequests();
      runs++;
    }, fail);
    maintenance.request();
    await entered.promise;
    maintenance.request();
    resume.release();
    await maintenance.settle();
    expect(runs).toBe(1);
  });

  it('reports an asynchronous maintenance failure to its owner', async () => {
    const failure = new Error('candidate copy failed');
    const failures: unknown[] = [];
    const maintenance = new DeferredMaintenance(
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
