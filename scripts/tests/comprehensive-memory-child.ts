/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  withSuffixFixture,
  suffixRow,
} from '../../packages/core/src/services/history/history-suffix-test-helpers.js';
import type { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import { retainHistoryForMemoryTrap } from './retaining-history-test-helper.js';

async function settleHeap(): Promise<NodeJS.MemoryUsage> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gcAndSweep();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gcAndSweep();
  return { ...process.memoryUsage(), heapUsed: heapSize() };
}

async function* eagerTrap(
  service: HistoryService,
): AsyncGenerator<IContent, void, unknown> {
  const rows = retainHistoryForMemoryTrap(service);
  yield* rows;
}

async function compress(service: HistoryService, size: number): Promise<void> {
  for (let round = 0; round < 5; round++)
    await service.replaceAll([suffixRow(size + round)], 'test');
  await service.replaceAll(
    Array.from({ length: size }, (_, index) => suffixRow(index, 2048)),
    'test',
  );
  await service.waitForTokenUpdates();
  await service.waitForCommit();
  await service.waitForOwnershipSettlement();
}

const pin = readFileSync(
  new URL('../../.bun-version', import.meta.url),
  'utf8',
).trim();
if (Bun.version !== pin)
  throw new Error(`Expected Bun ${pin}; got ${Bun.version}`);
const size = Number(process.argv[2]);
const trap = process.argv[3] === 'trap';
const compressed = process.argv[4] === 'compressed';
const output = process.argv[5];
if (![512, 8192].includes(size) || output === undefined)
  throw new Error('Expected 512 or 8192 rows and a measurement output path');
await withSuffixFixture(32, async (service) => {
  for await (const row of service.getComprehensive()) void row;
});
await withSuffixFixture(
  size,
  async (service, ownership) => {
    if (compressed) await compress(service, size);
    const before = await settleHeap();
    const iterator = trap ? eagerTrap(service) : service.getComprehensive();
    try {
      const first = await iterator.next();
      if (first.done) throw new Error('Missing first row');
      const held = await settleHeap();
      writeFileSync(
        output,
        JSON.stringify({
          size,
          trap,
          compressed,
          heap: held.heapUsed - before.heapUsed,
          external: held.external - before.external,
          peakRows: ownership.snapshot().peakRows,
          liveRows: ownership.snapshot().liveRows,
        }) + '\n',
      );
    } finally {
      await iterator.return();
    }
    if (ownership.snapshot().liveRows !== 0)
      throw new Error('Unreleased iterator owner');
  },
  2048,
);
