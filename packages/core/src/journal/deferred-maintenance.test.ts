/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DeferredMaintenance } from './deferred-maintenance.js';

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
