/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';
import { readFileSync } from 'node:fs';
import { withSuffixFixture } from '../../packages/core/src/services/history/history-suffix-test-helpers.js';
import { ownerFixtureRow } from '../../packages/core/src/services/history/chronology-rollback-owner-helpers.js';
import {
  exactTokenizer,
  rejectedValue,
} from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';
import { transformFixture } from '../../packages/core/src/services/history/row-transform-test-helpers.js';
import { RowOwnership } from '../../packages/core/src/recording/rowOwnership.js';

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
    history.setTokenizerFactory(exactTokenizer());
    await transformFixture(history, false, () => undefined);
  },
  2048,
  ownerFixtureRow,
);
const owners = new RowOwnership();
await withSuffixFixture(
  size,
  async (history) => {
    history.setTokenizerFactory(exactTokenizer());
    let reached: (() => void) | undefined;
    let release: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const before = await settled();
    const primary = new Error('paused publication rollback');
    const operation = rejectedValue(
      transformFixture(history, trap, async () => {
        reached?.();
        await gate;
        throw primary;
      }),
    );
    await ready;
    try {
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
      release?.();
    }
    if ((await operation) !== primary)
      throw new Error('Lost primary publication failure');
    gcAndSweep();
    let restored = 0;
    for await (const row of history.streamRawHistory()) {
      const expected = JSON.stringify(ownerFixtureRow(restored++, 2048));
      if (JSON.stringify(row) !== expected)
        throw new Error(`Incomplete rollback at row ${restored - 1}`);
    }
    if (restored !== size || owners.snapshot().liveRows !== 0)
      throw new Error('Incomplete rollback or unreleased owners');
  },
  2048,
  ownerFixtureRow,
  owners,
);
