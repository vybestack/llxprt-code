/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { describe, expect, it } from 'bun:test';
import { batchGate } from './__tests__/support/addbatch-stream-test-helpers.js';
import {
  journalMediaParticipant as mediaParticipant,
  rejectedValue,
} from './chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
} from './detached-rollback-test-helpers.js';
import {
  checkpointRows,
  type HistoryCheckpoint,
} from './historyCheckpointRows.js';
import type { IContent } from './IContent.js';
import {
  probeTransformRow,
  recordTransformPhase,
  sweepTransformRows,
  transformProbes,
  withValueTransformFixture,
} from './transform-value-test-helpers.js';

async function* values(size: number): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) yield suffixRow(index, 2048);
}
async function* snapshotRows(
  snapshot: HistoryCheckpoint,
): AsyncGenerator<IContent, void, unknown> {
  yield* checkpointRows(snapshot);
}
function submit(
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

async function pendingCheckpoint(size: number): Promise<void> {
  await withValueTransformFixture(async (fixture) => {
    const { history, recorder, owners } = fixture;
    await history.detachedValues.replace(values(size));
    const probes = transformProbes();
    const ready = batchGate();
    const release = batchGate();
    fixture.pauseWriter();
    submit(history, probes, size);
    submit(history, probes, size + 1);
    let reached = false;
    let escaped: HistoryCheckpoint | undefined;
    const operation = rejectedValue(
      history.detachedValues.withCheckpoint(async (checkpoint) => {
        const snapshot = checkpoint;
        reached = true;
        escaped = snapshot;
        ready.resolve();
        await release.promise;
        expect(await detachedDigest(snapshotRows(snapshot))).toStrictEqual(
          await detachedDigest(values(size + 2)),
        );
        await history.detachedValues.replace(values(1));
        await history.detachedValues.replace(checkpointRows(snapshot));
      }),
    );
    try {
      await fixture.writerPaused;
      await sweepTransformRows();
      expect(reached).toBe(false);
      expect(
        recordTransformPhase(
          'ticket-checkpoint',
          'paused',
          size,
          owners,
          probes,
        ),
      ).toStrictEqual({ callerRows: 0, callerMarkers: 0 });
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      fixture.releaseWriter();
      await ready.promise;
      release.resolve();
      expect(await operation).toBeUndefined();
      expect(await detachedDurableDigest(recorder)).toStrictEqual(
        await detachedDigest(values(size + 2)),
      );
      expect(history.getTotalTokens()).toBe(size + 2);
      if (escaped === undefined) throw new Error('Missing escaped checkpoint');
      await expect(checkpointRows(escaped).next()).rejects.toThrow(
        /closed|pin was released/,
      );
      expect(owners.snapshot().liveRows).toBe(0);
    } finally {
      fixture.releaseWriter();
      release.resolve();
      await operation;
    }
  });
}

describe('checkpoint value tickets across writer backpressure', () => {
  it.each([512, 8192])(
    'captures complete %i-row values and closes the escaped checkpoint',
    async (size) => {
      await expect(pendingCheckpoint(size)).resolves.toBeUndefined();
    },
    180_000,
  );
  it('preserves cancellation identity without losing the admitted row', async () => {
    await withValueTransformFixture(async (fixture) => {
      fixture.pauseWriter();
      fixture.history.add(suffixRow(0, 2048));
      const controller = new AbortController();
      const failure = new Error('cancelled checkpoint');
      let reached = false;
      const operation = rejectedValue(
        fixture.history.detachedValues.withCheckpoint(async () => {
          reached = true;
        }, controller.signal),
      );
      await fixture.writerPaused;
      controller.abort(failure);
      expect(await operation).toBe(failure);
      expect(reached).toBe(false);
      fixture.releaseWriter();
      await fixture.history.waitForCommit();
      expect(
        await detachedDigest(fixture.history.streamRawHistory()),
      ).toStrictEqual(await detachedDigest(values(1)));
      await fixture.history.waitForCommit();
      expect(await detachedDurableDigest(fixture.recorder)).toStrictEqual(
        await detachedDigest(values(1)),
      );
      await fixture.history.detachedValues.replace(values(2));
      expect(fixture.history.getTotalTokens()).toBe(2);
      expect(fixture.owners.snapshot().liveRows).toBe(0);
    });
  }, 180_000);
});

describe('value-stage disk failure compensation', () => {
  it('preserves the staging error and complete durable baseline after media publication', async () => {
    await withValueTransformFixture(
      async ({ history, recorder, owners, io }) => {
        await history.detachedValues.replace(values(3));
        const before = await detachedDigest(values(3));
        const primary = new Error('published value stage write failed');
        let inject = true;
        let ownership = 'baseline';
        let rolledBack = false;

        await history.registerMediaOwner(
          mediaParticipant(() => ({
            publish: () => {
              ownership = 'replacement';
              if (inject) {
                inject = false;
                io.rejectNextWrite(primary);
              }
            },
            rollback: () => {
              ownership = 'baseline';
              rolledBack = true;
            },
          })),
        );
        const actual = await rejectedValue(
          history.detachedValues.replace(values(5)),
        );
        expect(actual).toBe(primary);
        expect(rolledBack).toBe(true);
        expect(ownership).toBe('baseline');
        await history.waitForCommit();
        expect(await detachedDurableDigest(recorder)).toStrictEqual(before);
        expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
          before,
        );
        expect(history.getTotalTokens()).toBe(3);
        expect(owners.snapshot().liveRows).toBe(0);
      },
    );
  }, 180_000);
});
