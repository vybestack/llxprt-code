/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { probedTransformInput } from '@vybestack/llxprt-code-core/services/history/__tests__/support/transform-value-fixtures-test-helpers.js';
import { rejectedValue } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
} from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import {
  pauseTransformFinalization,
  transformPhaseSampler,
  transformProbes,
  withValueTransformFixture,
} from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import { describe, expect, it } from 'bun:test';
import { observeRowOwnership } from './support/observed-row-ownership.js';
import {
  executeTruncation,
  truncationValueRow,
  truncationValues,
} from './truncation-value-helpers.js';

import type { SessionRecordingPort } from '@vybestack/llxprt-code-core/recording/recordingPort.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

async function finalValues(
  history: HistoryService,
  recorder: SessionRecordingPort,
  size: number,
  rollback: boolean,
): Promise<void> {
  const start = rollback ? 0 : 11;
  const expected = await detachedDigest(
    truncationValues(size, start, 2048, !rollback),
  );
  expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
    expected,
  );
  expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
  expect(history.getTotalTokens()).toBe(size - start);
  expect(history.getCacheAnchorSeq()).toBe(rollback ? 1 : 0);
  expect(history.getContextRange()).toStrictEqual({
    firstSeq: start + 1,
    lastSeq: size,
    totalEntries: size - start,
    removedInterior: [],
    approximate: false,
  });
}

async function ownership(size: number, rollback: boolean): Promise<number> {
  return withValueTransformFixture(async (fixture) => {
    const { history, recorder, owners } = fixture;
    const probes = transformProbes();
    const sample = transformPhaseSampler('truncation', size, owners, probes);
    await history.detachedValues.replace(
      probedTransformInput(size, truncationValueRow, owners, probes),
    );
    expect(probes.rows.length).toBe(size);
    expect(probes.markers.length).toBe(size);
    history.setCacheAnchorSeq(1);
    history.openDumpSnapshot = async () => {
      throw new Error('Borrowed dump preparation reached');
    };

    const expected = await detachedDigest(
      truncationValues(size, 11, 2048, true),
    );
    const failure = new Error('truncation finalization rejection');
    const paused = await pauseTransformFinalization(
      history,
      rollback ? failure : undefined,
    );
    const observed = observeRowOwnership(owners);
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
      await Promise.race([
        fixture.writerPaused,
        operation.then((result) => {
          throw new Error(`Ended before content writer: ${String(result)}`);
        }),
      ]);
      expect(returned).toBe(false);
      expect(owners.snapshot().liveRows).toBeGreaterThan(0);
      expect(owners.snapshot().liveRows).toBe(observed.rows());
      expect(observed.bytes()).toBeGreaterThan(2048);
      expect(owners.snapshot().liveSerializedBytes).toBe(observed.bytes());
      await sample('writer-paused');
      fixture.releaseWriter();
      await paused.acknowledged;
      expect(returned).toBe(false);
      await sample('acknowledged');
      expect(await detachedDigest(fixture.primaryRows())).toStrictEqual(
        expected,
      );
      expect(history.getTotalTokens()).toBe(size - 11);
      paused.release();
      expect(await operation).toBe(rollback ? failure : undefined);
      await sample(rollback ? 'rollback' : 'complete');
      await finalValues(history, recorder, size, rollback);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      return size - 11;
    } finally {
      fixture.releaseWriter();
      paused.release();
      await operation;
      observed.close();
    }
  });
}

describe('reachable truncation checkpoint/value caller', () => {
  for (const size of [512, 8192]) {
    for (const rollback of [false, true]) {
      it(`charges the actual writer and releases all ${size} original rows/markers, rollback=${rollback}`, async () => {
        expect(await ownership(size, rollback)).toBe(size - 11);
      }, 120_000);
    }
  }
});
