/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withValueTransformFixture,
  transformProbes,
  transformPhaseSampler,
  pauseTransformFinalization,
} from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import { probedTransformInput } from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers-fixtures.js';
import {
  detachedDigest,
  detachedDurableDigest,
} from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import { rejectedValue } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  highdensityRow,
  highdensitySetup,
  highdensityOracle,
} from './highdensity-disk-helpers.js';

function highdensityValueRow(index: number): ReturnType<typeof highdensityRow> {
  const row = highdensityRow(index);
  return row.blocks.length === 0
    ? { ...row, blocks: [{ type: 'text', text: `valid-prefix-${index}` }] }
    : row;
}

async function highdensity(size: number): Promise<number> {
  return withValueTransformFixture(async (fixture) => {
    const { history, recorder, owners } = fixture;
    const probes = transformProbes();
    const sample = transformPhaseSampler(
      'highdensity-shared-truncation',
      size,
      owners,
      probes,
    );
    await history.detachedValues.replace(
      probedTransformInput(size, highdensityValueRow, owners, probes),
    );
    const oracle = await highdensityOracle(
      history,
      size,
      2048,
      highdensityValueRow,
    );
    const expected = await detachedDigest(
      (async function* () {
        for (const row of oracle)
          yield {
            speaker: row.speaker,
            blocks: row.blocks,
            metadata: row.metadata,
          };
      })(),
    );
    history.openDumpSnapshot = async () => {
      throw new Error('Borrowed highdensity dump reached');
    };
    const { handler } = highdensitySetup(history);
    const paused = pauseTransformFinalization(history);
    fixture.pauseWriter();
    const operation = rejectedValue(
      handler.performCompression('values').then((result) => {
        expect(result).toBe(PerformCompressionResult.COMPRESSED);
      }),
    );
    try {
      await Promise.race([
        fixture.writerPaused,
        operation.then((result) => {
          throw new Error(`Highdensity ended before writer: ${String(result)}`);
        }),
      ]);
      expect(owners.snapshot().liveRows).toBeGreaterThan(0);
      await sample('writer-paused');
      fixture.releaseWriter();
      await paused.acknowledged;
      await sample('acknowledged');
      expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
      paused.release();
      expect(await operation).toBeUndefined();
      await sample('complete');
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        expected,
      );
      expect(owners.snapshot().liveRows).toBe(0);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      return expected.count;
    } finally {
      fixture.releaseWriter();
      paused.release();
      await operation;
    }
  });
}

describe('high-density caller of truncation publication', () => {
  it.each([512, 8192])(
    'uses detached checkpoint and bounded value publication for %i rows',
    async (size) => {
      expect(await highdensity(size)).toBeGreaterThan(0);
    },
    180_000,
  );
});
