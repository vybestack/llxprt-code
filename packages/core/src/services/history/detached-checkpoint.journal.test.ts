/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { batchGate } from './__tests__/support/addbatch-stream-test-helpers.js';
import { detachedDigest } from './detached-rollback-test-helpers.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
import {
  checkpointRows,
  type HistoryCheckpoint,
} from './historyCheckpointRows.js';
import {
  transformProbes,
  probeTransformRow,
  expectTransformReleased,
} from './transform-value-test-helpers.js';
import type { IContent } from './IContent.js';

async function* values(
  size: number,
  bytes = 2048,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) yield suffixRow(index, bytes);
}

function addPending(
  history: Parameters<
    Parameters<typeof withNativeDetachedFixture>[0]
  >[0]['history'],
  probes: ReturnType<typeof transformProbes>,
  index: number,
): void {
  const row = suffixRow(index, 2048);
  probeTransformRow(row, probes);
  history.add(row);
}

async function captures(size: number): Promise<void> {
  await withNativeDetachedFixture(async (fixture) => {
    const { history, owners } = fixture;
    await history.detachedValues.replace(values(size));
    const expected = await detachedDigest(values(size + 2));
    const probes = transformProbes();
    fixture.pauseWriter();
    addPending(history, probes, size);
    addPending(history, probes, size + 1);
    const ready = batchGate();
    const release = batchGate();
    let held: HistoryCheckpoint | undefined;
    let reached = false;
    const operation = rejectedValue(
      history.detachedValues.withCheckpoint(async (checkpoint) => {
        held = checkpoint;
        reached = true;
        ready.resolve();
        await release.promise;
        expect(await detachedDigest(checkpointRows(checkpoint))).toStrictEqual(
          expected,
        );
        await history.detachedValues.replace(values(1));
        expect(await detachedDigest(checkpointRows(checkpoint))).toStrictEqual(
          expected,
        );
        await history.detachedValues.replace(checkpoint);
      }),
    );
    try {
      await Promise.race([fixture.writerPaused, operation]);
      expect(reached).toBe(false);
      await expectTransformReleased(
        'native-checkpoint',
        'input-writer-paused',
        size,
        owners,
        probes,
      );
      expect(owners.snapshot().liveRows).toBe(0);
      fixture.releaseWriter();
      await Promise.race([ready.promise, operation]);
      expect(reached).toBe(true);
      await expectTransformReleased(
        'native-checkpoint',
        'acknowledged',
        size,
        owners,
        probes,
      );
      expect(owners.snapshot().liveRows).toBe(0);
      release.resolve();
      expect(await operation).toBeUndefined();
      expect(await fixture.durable()).toStrictEqual(expected);
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        expected,
      );
      expect(history.getTotalTokens()).toBe(size + 2);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      if (held === undefined) throw new Error('Missing checkpoint');
      await expect(detachedDigest(checkpointRows(held))).rejects.toThrow(
        'pin was released',
      );
    } finally {
      fixture.releaseWriter();
      release.resolve();
      await operation;
    }
  });
}

describe('native detached checkpoint public contracts', () => {
  it.each([512, 8192])(
    'captures and restores all %i rows with pending writer backpressure',
    async (size) => {
      await expect(captures(size)).resolves.toBeUndefined();
    },
    180_000,
  );

  it('restores every byte of a checkpoint row larger than nine MiB', async () => {
    await withNativeDetachedFixture(async ({ history, durable }) => {
      const bytes = 9 * 1024 * 1024 + 1;
      const expected = await detachedDigest(values(1, bytes));
      expect(expected.bytes).toBeGreaterThan(9 * 1024 * 1024);
      await history.detachedValues.replace(values(1, bytes));
      await history.detachedValues.withCheckpoint(async (checkpoint) => {
        await history.detachedValues.replace(values(2));
        await history.detachedValues.replace(checkpoint);
      });
      expect(await durable()).toStrictEqual(expected);
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        expected,
      );
    });
  }, 180_000);

  it('captures pending cyclic tool parameters and restores their sanitized value without mutating the caller', async () => {
    await withNativeDetachedFixture(async (fixture) => {
      const parameters: { name: string; self?: object } = { name: 'loop' };
      parameters.self = parameters;
      const expected: IContent['blocks'] = [
        {
          type: 'tool_call',
          id: 'cycle',
          name: 'inspect',
          parameters: { name: 'loop', self: { _circular: true } },
        },
      ];
      fixture.pauseWriter();
      fixture.history.add({
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'cycle', name: 'inspect', parameters },
        ],
      });
      const operation = fixture.history.detachedValues.withCheckpoint(
        async (checkpoint) => {
          let count = 0;
          for await (const row of checkpointRows(checkpoint)) {
            expect(row.blocks).toStrictEqual(expected);
            count++;
          }
          expect(count).toBe(1);
          await fixture.history.detachedValues.replace(values(2));
          await fixture.history.detachedValues.replace(checkpoint);
        },
      );
      await fixture.writerPaused;
      fixture.releaseWriter();
      await operation;
      for await (const row of fixture.history.streamRawHistory())
        expect(row.blocks).toStrictEqual(expected);
      expect((await fixture.durable()).count).toBe(1);
      let persisted = 0;
      for await (const row of fixture.persistedRows()) {
        expect(row.blocks).toStrictEqual(expected);
        persisted++;
      }
      expect(persisted).toBe(1);
      expect(parameters.self).toBe(parameters);
      expect(fixture.history.getTotalTokens()).toBe(1);
    });
  }, 180_000);
});
