/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';
import { readFileSync } from 'node:fs';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { ownerFixtureRow } from '../../packages/core/src/services/history/chronology-rollback-owner-test-helpers.js';
import { SemanticMediaPurgeStreamCoordinator } from '../../packages/core/src/services/history/semantic-purge-stream.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import { RowOwnership } from '../../packages/core/src/recording/rowOwnership.js';

function imageRow(index: number, bytes: number): IContent {
  const row = ownerFixtureRow(index, bytes);
  return {
    ...row,
    blocks: row.blocks.map((block) =>
      block.type === 'media' ? { ...block, mimeType: 'image/png' } : block,
    ),
  };
}
async function settled(): Promise<{ heap: number; external: number }> {
  await Bun.sleep(0);
  gcAndSweep();
  await Bun.sleep(0);
  gcAndSweep();
  return { heap: heapSize(), external: process.memoryUsage().external };
}
const pin = readFileSync(
  new URL('../../.bun-version', import.meta.url),
  'utf8',
).trim();
if (Bun.version !== pin)
  throw new Error(`Expected Bun ${pin}; got ${Bun.version}`);
const size = Number(process.argv[2]);
const trap = process.argv[3] === 'trap';
if (![512, 8192].includes(size))
  throw new Error('Expected fixture size 512 or 8192');
await withSuffixFixture(
  32,
  async (history) => {
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });
    const transaction = await coordinator.begin({ mode: 'remove' });
    if (transaction === undefined)
      throw new Error('Missing warmup transaction');
    transaction.close();
  },
  2048,
  imageRow,
);
async function retainTrap(
  source: AsyncIterable<IContent>,
  retained: IContent[],
  owners: RowOwnership,
): Promise<void> {
  for await (const row of source) {
    retained.push(row);
    owners.retain(row);
    if (row.metadata?.chronology !== undefined)
      owners.retain(row.metadata.chronology);
  }
}

const owners = new RowOwnership();
await withSuffixFixture(
  size,
  async (history) => {
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
      ownership: owners,
    });
    const before = await settled();
    const transaction = await coordinator.begin({ mode: 'remove' });
    if (transaction === undefined) throw new Error('Missing transaction');
    const retained: IContent[] = [];
    const cursor = transaction.requestRows(true);
    try {
      if (trap)
        await retainTrap(transaction.base.streamRows(), retained, owners);
      const first = await cursor.next();
      if (first.done === true) throw new Error('Missing request row');
      const held = await settled();
      const census = owners.snapshot();
      process.stdout.write(
        JSON.stringify({
          size,
          trap,
          heap: held.heap - before.heap,
          external: held.external - before.external,
          heldRows: census.liveRows,
          heldBytes: census.liveSerializedBytes,
          peakRows: census.peakRows,
          peakBytes: census.peakSerializedBytes,
        }) + '\n',
      );
    } finally {
      await cursor.return();
      for (const row of retained) {
        if (row.metadata?.chronology !== undefined)
          owners.release(row.metadata.chronology);
        owners.release(row);
      }
      transaction.close();
    }
    if (owners.snapshot().liveRows !== 0)
      throw new Error('Unreleased semantic purge owners');
  },
  2048,
  imageRow,
  owners,
);
