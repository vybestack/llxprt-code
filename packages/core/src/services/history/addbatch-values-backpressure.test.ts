/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { expectTicketCallersReleased } from './ticket-owner-contract-test-helpers.js';
import {
  captureTicketWrite,
  expectTicketDisk,
} from './ticket-disk-contract-test-helpers.js';
import { gcAndSweep } from 'bun:jsc';
import { setImmediate } from 'node:timers/promises';
import {
  batchRow,
  withBatchFixture,
  recordBatchOwners,
} from './addbatch-stream-test-helpers.js';
import {
  transformProbes,
  probeTransformRow,
} from './transform-value-test-helpers.js';
import type { IContent } from './IContent.js';

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
          pauseWriter();
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
            const ticket = captureTicketWrite(recorder);
            const pending = owners.snapshot();
            recordBatchOwners('value-pending-ack', size, owners);
            expect(pending.liveRows).toBe(1);
            expect(pending.liveRows).toBeLessThanOrEqual(440);
            expect(pending.liveSerializedBytes).toBe(
              Buffer.byteLength(JSON.stringify(batchRow(0))),
            );
            expect(pending.liveSerializedBytes).toBeLessThanOrEqual(
              8 * 1024 * 1024,
            );
            expect(published).toBe(false);
            expect(history.length()).toBe(1);
            releaseWriter();
            await operation;
            await expectTicketDisk(recorder, ticket, size, batchRow, true);
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
