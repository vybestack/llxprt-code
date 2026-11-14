/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep } from 'bun:jsc';
import { describe, expect, it } from 'bun:test';
import { setImmediate } from 'node:timers/promises';
import {
  batchRow,
  recordBatchOwners,
  withBatchFixture,
} from './__tests__/support/addbatch-stream-test-helpers.js';
import { durableRowsOf } from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';
import { expectTicketCallersReleased } from './ticket-owner-contract-test-helpers.js';
import {
  probeTransformRow,
  transformProbes,
} from './transform-value-test-helpers.js';

async function collect(
  probes: ReadonlyArray<WeakRef<IContent>>,
): Promise<number> {
  for (let index = 0; index < 8; index++) {
    await setImmediate();
    gcAndSweep();
  }
  await setImmediate();
  return probes.filter((probe) => probe.deref() !== undefined).length;
}

describe('value append writer acknowledgement', () => {
  for (const size of [512, 8192]) {
    it(`keeps the actual pending value charged and releases ${size} caller roots before acknowledgement`, async () => {
      await withBatchFixture(
        async ({
          history,
          recorder,
          owners,
          pauseWriter,
          waitForPausedWrite,
          releaseWriter,
        }) => {
          pauseWriter(size);
          let input = Array.from({ length: size }, (_, index) =>
            batchRow(index),
          );
          const weak = input.map((row) => new WeakRef(row));
          const probes = transformProbes();
          for (const row of input) probeTransformRow(row, probes);
          let published = false;
          history.once('tokensUpdated', () => {
            published = true;
          });
          const operation = history.addBatch(input);
          input = [];
          try {
            await waitForPausedWrite;
            expect(await collect(weak)).toBe(0);
            await expectTicketCallersReleased(probes);
            const pending = owners.snapshot();
            recordBatchOwners('value-pending-ack', size, owners);
            expect(pending.liveRows).toBe(0);
            expect(pending.liveRows).toBeLessThanOrEqual(440);
            expect(pending.liveSerializedBytes).toBe(0);
            expect(pending.liveSerializedBytes).toBeLessThanOrEqual(
              8 * 1024 * 1024,
            );
            expect(published).toBe(false);
            expect(history.length()).toBe(size);
            releaseWriter();
            await operation;
            expect(await durableRowsOf(recorder)).toStrictEqual(
              Array.from({ length: size }, (_, index) => batchRow(index)),
            );
            expect(published).toBe(true);
            expect(history.length()).toBe(size);
            expect(history.getTotalTokens()).toBe(4 * size);
            expect(owners.snapshot().liveRows).toBe(0);
            expect(owners.snapshot().liveSerializedBytes).toBe(0);
          } finally {
            releaseWriter();
            await operation;
          }
        },
      );
    }, 180_000);
  }
});
