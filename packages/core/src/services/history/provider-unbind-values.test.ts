/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHistoryProviderFileBindingStore } from './provider-file-binding.js';
import {
  detachedDigest,
  detachedDurableDigest,
} from './detached-rollback-test-helpers.js';
import {
  rejectedValue,
  expectedRange,
} from './chronology-rollback-test-helpers.js';
import {
  withValueTransformFixture,
  transformProbes,
  pauseTransformFinalization,
  transformPhaseSampler,
} from './transform-value-test-helpers.js';
import {
  TRANSFORM_CONTENT_ID,
  TRANSFORM_FILE,
  transformFixtureRows,
  transformFixtureRow,
  probedTransformInput,
} from './transform-value-test-helpers-fixtures.js';

async function observeUnbind(size: number, rollback: boolean): Promise<number> {
  return withValueTransformFixture(async (fixture) => {
    const { history, recorder, owners } = fixture;
    const probes = transformProbes();
    const sample = transformPhaseSampler(
      'provider-unbind',
      size,
      owners,
      probes,
    );
    await history.detachedValues.replace(
      probedTransformInput(size, transformFixtureRow, owners, probes),
    );
    const before = await detachedDigest(transformFixtureRows(size));
    expect(await detachedDurableDigest(recorder)).toStrictEqual(before);
    const tokens = size * 3;
    expect(history.getTotalTokens()).toBe(tokens);
    const failure = new Error('unbind finalization rollback');
    const finalization = pauseTransformFinalization(
      history,
      rollback ? failure : undefined,
    );
    fixture.pauseWriter();
    const reference = { ...TRANSFORM_FILE };
    try {
      const operation = rejectedValue(
        createHistoryProviderFileBindingStore(history).unbind(
          TRANSFORM_CONTENT_ID,
          reference,
        ),
      );
      reference.fileId = 'changed-after-submission';
      await Promise.race([
        fixture.writerPaused,
        operation.then((result) => {
          throw new Error(
            `Unbind ended before writer pause: ${String(result)}`,
          );
        }),
      ]);
      await sample('writer-paused');
      expect(owners.snapshot().liveRows).toBeGreaterThan(0);
      fixture.releaseWriter();
      await finalization.acknowledged;
      await sample('acknowledged');
      expect(owners.snapshot().liveRows).toBe(0);
      const expected = await detachedDigest(transformFixtureRows(size, false));
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        expected,
      );
      expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
      expect(history.getTotalTokens()).toBe(tokens);
      expect(history.getContextRange()).toStrictEqual(expectedRange(size));
      finalization.release();
      expect(await operation).toBe(rollback ? failure : undefined);
      await sample(rollback ? 'rollback' : 'complete');
      expect(owners.snapshot().liveRows).toBe(0);
      expect(owners.external.snapshot().peakRows).toBe(2);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      const restored = rollback ? before : expected;
      expect(await detachedDurableDigest(recorder)).toStrictEqual(restored);
      const current = await detachedDigest(history.streamRawHistory());
      expect(current).toStrictEqual(restored);
      expect(history.getTotalTokens()).toBe(tokens);
      return current.count;
    } finally {
      fixture.releaseWriter();
      finalization.release();
    }
  });
}

describe('provider unbind disk value transaction', () => {
  for (const size of [512, 8192]) {
    for (const rollback of [false, true]) {
      it(`releases original row/marker roots and preserves full values at ${size}, rollback=${rollback}`, async () => {
        expect(await observeUnbind(size, rollback)).toBe(size);
      }, 120_000);
    }
  }
  it('retains every byte of a valid row larger than nine MiB', async () => {
    await withValueTransformFixture(async ({ history, recorder }) => {
      const bytes = 9 * 1024 * 1024 + 1;
      await history.detachedValues.replace(
        transformFixtureRows(1, true, bytes),
      );
      await createHistoryProviderFileBindingStore(history).unbind(
        TRANSFORM_CONTENT_ID,
        TRANSFORM_FILE,
      );
      const expected = await detachedDigest(
        transformFixtureRows(1, false, bytes),
      );
      expect(expected.bytes).toBeGreaterThan(9 * 1024 * 1024);
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        expected,
      );
      expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
    });
  }, 120_000);
});
