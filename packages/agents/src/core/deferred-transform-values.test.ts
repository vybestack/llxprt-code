/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { admitDeferredHistorySource } from './deferredHistorySource.js';
import {
  buildAgent,
  internalConfig,
} from '../api/__tests__/helpers/agentHarness.js';
import {
  withValueTransformFixture,
  transformProbes,
  pauseTransformFinalization,
  transformPhaseSampler,
} from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import { probedTransformInput } from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers-fixtures.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
} from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import {
  rejectedValue,
  expectedRange,
} from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';

async function* expectedSource(
  size: number,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) yield suffixRow(index, 2048);
}

function deferredInputRow(index: number): IContent {
  return suffixRow(index, 2048);
}

async function observeDeferred(
  size: number,
  rollback: boolean,
  store: LocalMediaStore,
): Promise<number> {
  return withValueTransformFixture(async (fixture) => {
    const { history, recorder, owners } = fixture;
    await history.detachedValues.replace(expectedSource(3));
    const baseline = await detachedDigest(expectedSource(3));
    expect(history.getTotalTokens()).toBe(3);
    const probes = transformProbes();
    const sample = transformPhaseSampler(
      'deferred-admission',
      size,
      owners,
      probes,
    );
    const failure = new Error('deferred streamed finalization rollback');
    const finalization = pauseTransformFinalization(
      history,
      rollback ? failure : undefined,
    );
    fixture.pauseWriter();
    try {
      const operation = rejectedValue(
        admitDeferredHistorySource(
          history,
          probedTransformInput(size, deferredInputRow, owners, probes),
          store,
          { ownership: owners },
          'fake-model',
        ).then(async (release) => {
          await release();
        }),
      );
      await Promise.race([
        fixture.writerPaused,
        operation.then((result) => {
          throw new Error(
            `Deferred admission ended before writer pause: ${String(result)}`,
          );
        }),
      ]);
      expect(probes.rows.length).toBe(size);
      expect(probes.markers.length).toBe(size);
      await sample('writer-paused');
      expect(owners.snapshot().liveRows).toBeGreaterThan(0);
      fixture.releaseWriter();
      await finalization.acknowledged;
      await sample('acknowledged');
      expect(owners.snapshot().liveRows).toBe(0);
      const expected = await detachedDigest(expectedSource(size));
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        expected,
      );
      expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
      expect(history.getContextRange()).toStrictEqual(expectedRange(size));
      expect(history.getTotalTokens()).toBe(size);
      finalization.release();
      expect(await operation).toBe(rollback ? failure : undefined);
      await sample(rollback ? 'rollback' : 'complete');
      expect(owners.snapshot().liveRows).toBe(0);
      expect(owners.external.snapshot().peakRows).toBe(2);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      const restored = rollback ? baseline : expected;
      const current = await detachedDigest(history.streamRawHistory());
      expect(current).toStrictEqual(restored);
      expect(await detachedDurableDigest(recorder)).toStrictEqual(restored);
      expect(history.getTotalTokens()).toBe(rollback ? 3 : size);
      return current.count;
    } finally {
      fixture.releaseWriter();
      finalization.release();
    }
  });
}

describe('deferred history uses disk value transform', () => {
  for (const size of [512, 8192]) {
    for (const rollback of [false, true]) {
      it(`bounds the complete streamed input and publication at ${size}, rollback=${rollback}`, async () => {
        const { agent, cleanup } = await buildAgent('plain-text.jsonl');
        try {
          expect(
            await observeDeferred(
              size,
              rollback,
              internalConfig(agent).getLocalMediaStore(),
            ),
          ).toBe(rollback ? 3 : size);
        } finally {
          await cleanup();
        }
      }, 120_000);
    }
  }
});
