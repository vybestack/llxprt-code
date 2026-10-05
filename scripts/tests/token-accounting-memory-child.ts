/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';
import { readFileSync } from 'node:fs';
import { withSuffixFixture } from '../../packages/core/src/services/history/history-suffix-test-helpers.js';
import {
  accountingFactory,
  accountingRow,
  deferred,
  recalculate,
} from '../../packages/core/src/services/history/token-accounting-stream-test-helpers.js';
import { retainHistoryForMemoryTrap } from './retaining-history-test-helper.js';

async function settleHeap(): Promise<NodeJS.MemoryUsage> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gcAndSweep();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gcAndSweep();
  return { ...process.memoryUsage(), heapUsed: heapSize() };
}

const pin = readFileSync(
  new URL('../../.bun-version', import.meta.url),
  'utf8',
).trim();
if (Bun.version !== pin)
  throw new Error(`Expected Bun ${pin}; got ${Bun.version}`);
const size = Number(process.argv[2]);
const method = process.argv[3];
const trap = process.argv[4] === 'trap';
if (
  !Number.isSafeInteger(size) ||
  size < 1 ||
  (method !== 'total' && method !== 'legacy')
) {
  throw new Error('Expected positive row count and total/legacy method');
}
await withSuffixFixture(
  32,
  async (service) => {
    service.setTokenizerFactory(accountingFactory((text) => text.length));
    await recalculate(service, method);
  },
  2048,
  accountingRow,
);
await withSuffixFixture(
  size,
  async (service, ownership) => {
    const entered = deferred();
    const release = deferred();
    let first = true;
    service.setTokenizerFactory(
      accountingFactory(async (text) => {
        if (first) {
          first = false;
          entered.resolve();
          await release.promise;
        }
        return text.length;
      }),
    );
    const before = await settleHeap();
    const retained = trap ? retainHistoryForMemoryTrap(service) : undefined;
    const operation = recalculate(service, method);
    await entered.promise;
    try {
      const held = await settleHeap();
      process.stdout.write(
        JSON.stringify({
          size,
          method,
          trap,
          heap: held.heapUsed - before.heapUsed,
          external: held.external - before.external,
          liveRows: ownership.snapshot().liveRows,
          trapRows: retained?.length ?? 0,
        }) + '\n',
      );
    } finally {
      release.resolve();
      await operation;
    }
    if (ownership.snapshot().liveRows !== 0)
      throw new Error('Unreleased accounting rows');
  },
  2048,
  accountingRow,
);
