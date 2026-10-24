/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { describe, expect, it } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import type { IContent } from './IContent.js';
import { ownerFixtureRow } from './chronology-rollback-owner-test-helpers.js';
import {
  exactTokenizer,
  rejectedValue,
  rollbackRow,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';

async function compensationPressure(size: number): Promise<{
  readonly pending: number;
  readonly bytes: number;
}> {
  return withNativeDetachedFixture(async (fixture) => {
    const { history, io } = fixture;
    history.setTokenizerFactory(exactTokenizer());
    await history.detachedValues.replace(
      (async function* (): AsyncGenerator<IContent> {
        for (let index = 0; index < size; index++)
          yield ownerFixtureRow(index, 2048);
      })(),
    );
    const primary = new Error('force compensation');
    let writesBefore = 0;
    let bytesBefore = 0;
    history.once('tokensUpdated', () => {
      writesBefore = io.descriptorWrites;
      bytesBefore = io.descriptorWrittenBytes;
      fixture.pauseWriter(size);
      throw primary;
    });
    const operation = rejectedValue(
      history.applyDensityResult({
        replacements: new Map(),
        removals: [size - 1],
        metadata: {
          readWritePairsPruned: 0,
          fileDeduplicationsPruned: 0,
          recencyPruned: 1,
        },
      }),
    );
    await fixture.writerPaused;
    fixture.releaseWriter();
    expect(await operation).toBe(primary);
    await history.waitForCommit();
    const pending = io.descriptorWrites - writesBefore;
    const bytes = io.descriptorWrittenBytes - bytesBefore;
    let restored = 0;
    for await (const row of history.getRecent(0)) {
      expect(row).toStrictEqual(ownerFixtureRow(restored++, 2048));
    }
    expect(restored).toBe(size);
    return { pending, bytes };
  });
}

describe('disk candidate journal admission under writer backpressure', () => {
  it('restores source row values and tokens when density publication fails', async () => {
    await withRollbackFixture(async (history) => {
      const before = [rollbackRow(0), rollbackRow(1), rollbackRow(2)];
      await history.addBatch(before);
      const stored = await collectRawHistory(history);
      const primary = new Error('density publication');
      history.once('tokensUpdated', () => {
        throw primary;
      });
      const error = await rejectedValue(
        history.applyDensityResult({
          replacements: new Map(),
          removals: [2],
          metadata: {
            readWritePairsPruned: 0,
            fileDeduplicationsPruned: 0,
            recencyPruned: 1,
          },
        }),
      );
      expect(error).toBe(primary);
      expect(await collectRawHistory(history)).toStrictEqual(stored);
      expect(history.getTotalTokens()).toBe(12);
    });
  });

  for (const size of [512, 8192]) {
    it(`bounds compensation journal writes while restoring all ${size} source rows`, async () => {
      const result = await compensationPressure(size);
      const output = process.env.CHRONOLOGY_CANDIDATE_OUTPUT;
      if (output !== undefined)
        appendFileSync(
          output,
          JSON.stringify({ kind: 'admission', size, ...result }) +
            String.fromCharCode(10),
        );
      expect(result.pending).toBeLessThanOrEqual(2);
      expect(result.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    }, 120_000);
  }
});
