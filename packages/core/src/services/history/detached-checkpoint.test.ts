/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withValueTransformFixture,
  transformProbes,
  probeTransformRow,
  sweepTransformRows,
  recordTransformPhase,
} from './transform-value-test-helpers.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
} from './detached-rollback-test-helpers.js';
import {
  captureTicketWrite,
  expectTicketDisk,
} from './ticket-disk-contract-test-helpers.js';
import { batchGate } from './addbatch-stream-test-helpers.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
import type { HistoryIndexedRows } from './historyMutationSnapshot.js';
import type { IContent } from './IContent.js';

async function* values(size: number): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) yield suffixRow(index, 2048);
}

function addPending(
  history: Parameters<
    Parameters<typeof withValueTransformFixture>[0]
  >[0]['history'],
  probes: ReturnType<typeof transformProbes>,
  index: number,
): void {
  const row = suffixRow(index, 2048);
  probeTransformRow(row, probes);
  history.add(row);
}

async function* checkpointValues(
  snapshot: HistoryIndexedRows,
): AsyncGenerator<IContent, void, unknown> {
  yield* snapshot;
}

async function checkpoint(size: number): Promise<void> {
  await withValueTransformFixture(async (fixture) => {
    const { history, owners, recorder } = fixture;
    await history.detachedValues.replace(values(size));
    const probes = transformProbes();
    fixture.pauseWriter();
    addPending(history, probes, size);
    addPending(history, probes, size + 1);
    const ready = batchGate();
    const release = batchGate();
    let held: HistoryIndexedRows | undefined;
    let reached = false;
    const operation = rejectedValue(
      history.detachedValues.withCheckpoint(async (snapshot) => {
        held = snapshot;
        reached = true;
        ready.resolve();
        await release.promise;
        expect(await detachedDigest(checkpointValues(snapshot))).toStrictEqual(
          await detachedDigest(values(size + 2)),
        );
        await history.detachedValues.replace(values(1));
        await history.detachedValues.replace(snapshot);
      }),
    );
    try {
      await fixture.writerPaused;
      await sweepTransformRows();
      expect(reached).toBe(false);
      expect(
        recordTransformPhase(
          'checkpoint',
          'input-writer-paused',
          size,
          owners,
          probes,
        ),
      ).toStrictEqual({ callerRows: 0, callerMarkers: 0 });
      const ticket = captureTicketWrite(recorder);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(owners.snapshot().liveSerializedBytes).toBe(0);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      fixture.releaseWriter();
      await ready.promise;
      await expectTicketDisk(recorder, ticket, 2, (index) =>
        suffixRow(size + index, 2048),
      );
      await sweepTransformRows();
      expect(
        recordTransformPhase(
          'checkpoint',
          'acknowledged',
          size,
          owners,
          probes,
        ),
      ).toStrictEqual({ callerRows: 0, callerMarkers: 0 });
      expect(owners.snapshot().liveRows).toBe(0);
      release.resolve();
      expect(await operation).toBeUndefined();
      expect(await detachedDurableDigest(recorder)).toStrictEqual(
        await detachedDigest(values(size + 2)),
      );
      expect(history.getTotalTokens()).toBe(size + 2);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      expect(() => held?.readRow(0)).toThrow('closed');
    } finally {
      fixture.releaseWriter();
      release.resolve();
    }
  });
}

async function* oversizedValues(): AsyncGenerator<IContent, void, unknown> {
  yield suffixRow(0, 9 * 1024 * 1024 + 1);
}

describe('detached disk checkpoints', () => {
  it('restores every byte of a checkpoint row larger than nine MiB', async () => {
    await withValueTransformFixture(async ({ history, recorder }) => {
      await history.detachedValues.replace(oversizedValues());
      const expected = await detachedDigest(oversizedValues());
      expect(expected.bytes).toBeGreaterThan(9 * 1024 * 1024);
      await history.detachedValues.withCheckpoint(async (snapshot) => {
        await history.detachedValues.replace(values(2));
        await history.detachedValues.replace(snapshot);
      });
      expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        expected,
      );
    });
  }, 180_000);
  it.each([512, 8192])(
    'captures and restores all %i rows with pending writer backpressure',
    async (size) => {
      await expect(checkpoint(size)).resolves.toBeUndefined();
    },
    180_000,
  );
  it('cancels pending capture without invoking the checkpoint consumer', async () => {
    await withValueTransformFixture(async (fixture) => {
      const { history, owners } = fixture;
      fixture.pauseWriter();
      history.add(suffixRow(0));
      const controller = new AbortController();
      const failure = new DOMException('checkpoint cancelled', 'AbortError');
      let reached = false;
      const operation = rejectedValue(
        history.detachedValues.withCheckpoint(async () => {
          reached = true;
        }, controller.signal),
      );
      await fixture.writerPaused;
      controller.abort(failure);
      expect(await operation).toBe(failure);
      expect(reached).toBe(false);
      fixture.releaseWriter();
      await history.waitForCommit();
      expect(owners.snapshot().liveRows).toBe(0);
      await expect(
        history.detachedValues.replace(values(2)),
      ).resolves.toBeUndefined();
      expect(history.getTotalTokens()).toBe(2);
    });
  }, 180_000);
});
