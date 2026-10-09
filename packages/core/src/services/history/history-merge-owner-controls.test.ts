/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';
import { withCoreSuffixFixture } from './core-suffix-fixture-test-helpers.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';
import {
  MergeRowHistory,
  mergeRow,
  oracleDigest,
  streamDigest,
} from './history-merge-test-helpers.js';

function assertPositiveBounds(owners: RowOwnership): void {
  expect(owners.snapshot().peakRows).toBeLessThanOrEqual(440);
  expect(owners.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
    8 * 1024 * 1024,
  );
}

function assertRetainingEvidence(owners: RowOwnership, size: number): void {
  expect(owners.snapshot().liveRows).toBe(size);
  expect(owners.snapshot().peakRows).toBeGreaterThan(440);
  expect(owners.snapshot().peakSerializedBytes).toBeGreaterThan(
    size === 8192 ? 8 * 1024 * 1024 : 0,
  );
}

async function retainingMerge(size: number, copy: boolean): Promise<number> {
  const retained: IContent[] = [];
  const owners = new RowOwnership();
  try {
    await withCoreSuffixFixture(
      size,
      async (source) => {
        await withCoreSuffixFixture(
          0,
          async (target) => {
            target.setTokenizerFactory(exactTokenizer());
            target.on('contentAdded', (row) => {
              const kept = copy ? structuredClone(row) : row;
              owners.retain(kept);
              retained.push(kept);
            });
            await target.merge(source);
            expect(await streamDigest(target.streamRawHistory())).toBe(
              oracleDigest(size),
            );
            if (process.env.MERGE_RETAINING_TRAP === '1')
              assertPositiveBounds(owners);
            else assertRetainingEvidence(owners, size);
          },
          0,
          mergeRow,
          undefined,
          (options) => new MergeRowHistory(options),
        );
      },
      2048,
      mergeRow,
      undefined,
      (options) => new MergeRowHistory(options),
    );
  } finally {
    for (const row of retained) owners.release(row);
    retained.length = 0;
    expect(owners.snapshot().liveRows).toBe(0);
    expect(owners.snapshot().liveSerializedBytes).toBe(0);
  }
  return owners.snapshot().liveRows;
}

describe('history merge retaining controls', () => {
  for (const size of [512, 8192])
    for (const copy of [false, true])
      it(`detects ${copy ? 'distinct copy' : 'borrowed row'} retention for ${size} actual merged rows`, async () => {
        expect(await retainingMerge(size, copy)).toBe(0);
      }, 600_000);
});
