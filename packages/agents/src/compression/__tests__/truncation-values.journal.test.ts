/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  transformProbes,
  transformPhaseSampler,
} from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import { probedTransformInput } from '@vybestack/llxprt-code-core/services/history/__tests__/support/transform-value-fixtures-test-helpers.js';
import {
  exactTokenizer,
  rejectedValue,
} from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import {
  executeTruncation,
  truncationValueRow,
  truncationValues,
  expectedTruncationValue,
} from './truncation-value-helpers.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import {
  withNativeFallbackFixture,
  reachesGate,
} from './support/native-fallback-fixture.js';
import { observeNativeTruncation } from './support/native-truncation-observers.js';

async function ownership(size: number, rollback: boolean): Promise<void> {
  await withNativeFallbackFixture(async (fixture) => {
    const { history, owners, durable } = fixture;
    const probes = transformProbes();
    const sample = transformPhaseSampler(
      'native-truncation',
      size,
      owners,
      probes,
    );
    await history.detachedValues.replace(
      probedTransformInput(size, truncationValueRow, owners, probes),
    );
    expect(probes.rows.length).toBe(size);
    expect(probes.markers.length).toBe(size);
    history.setCacheAnchorSeq(1);
    history.openDumpSnapshot = async () => {
      throw new Error('Borrowed dump preparation reached');
    };
    let firstCharge: number | undefined;
    let firstRows: number | undefined;
    const published = observeNativeTruncation(history, () => {
      history.setTokenizerFactory(
        exactTokenizer(() => {
          firstCharge ??= owners.snapshot().liveSerializedBytes;
          firstRows ??= owners.snapshot().liveRows;
        }),
      );
    });
    const expected = await compressionValueDigest(
      truncationValues(size, 11, 2048, true),
    );
    const failure = new Error('truncation finalization rejection');
    await fixture.pauseFinalization(rollback ? failure : undefined);
    fixture.pauseWriter();
    let returned = false;
    const operation = rejectedValue(
      executeTruncation(history, size).then((result) => {
        returned = true;
        expect(result.outcome).toBe('applied');
        expect(result.summary).toBeUndefined();
      }),
    );
    try {
      await reachesGate(fixture.writerPaused, operation);
      expect(returned).toBe(false);
      expect(owners.snapshot().liveRows).toBeGreaterThan(0);
      expect(firstRows).toBe(2);
      expect(firstCharge).toBeGreaterThanOrEqual(
        Buffer.byteLength(JSON.stringify(expectedTruncationValue(11, 11))),
      );
      await sample('writer-paused');
      await published('writer-paused');
      fixture.releaseWriter();
      await reachesGate(fixture.acknowledged, operation);
      expect(returned).toBe(false);
      await sample('acknowledged');
      await published('acknowledged');
      expect(await durable(false)).toStrictEqual(expected);
      expect(history.getTotalTokens()).toBe(size - 11);
      fixture.releaseFinalization();
      expect(await operation).toBe(rollback ? failure : undefined);
      await sample(rollback ? 'rollback' : 'complete');
      await published(rollback ? 'rollback' : 'complete');
      const start = rollback ? 0 : 11;
      const final = await compressionValueDigest(
        truncationValues(size, start, 2048, !rollback),
      );
      expect(
        await compressionValueDigest(history.streamRawHistory()),
      ).toStrictEqual(final);
      expect(await durable()).toStrictEqual(final);
      expect(history.getTotalTokens()).toBe(size - start);
      expect(history.getCacheAnchorSeq()).toBe(rollback ? 1 : 0);
      expect(history.getContextRange()).toStrictEqual({
        firstSeq: start + 1,
        lastSeq: size,
        totalEntries: size - start,
        removedInterior: [],
        approximate: false,
      });
      expect(owners.snapshot().liveRows).toBe(0);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
    } finally {
      fixture.releaseWriter();
      fixture.releaseFinalization();
      await operation;
    }
  });
}

const cases = [512, 8192].flatMap((size) =>
  [false, true].map((rollback) => ({ size, rollback })),
);
describe('native reachable truncation checkpoint/value caller', () => {
  for (const { size, rollback } of cases) {
    it(`charges the actual writer and releases all ${size} original and published rows/markers, rollback=${rollback}`, async () => {
      await expect(ownership(size, rollback)).resolves.toBeUndefined();
    }, 120_000);
  }
});
