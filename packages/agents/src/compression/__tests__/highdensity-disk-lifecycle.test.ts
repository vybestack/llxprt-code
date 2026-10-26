/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { describe, expect, it } from 'bun:test';
import {
  HighdensityFaultHistory,
  deferred,
} from './highdensity-disk-fault-helpers.js';
import {
  HighdensityDiskHistory,
  highdensityRow,
  highdensitySetup,
} from './highdensity-disk-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';

async function pinned(size: number): Promise<number> {
  let created: HighdensityFaultHistory | undefined;
  return withSuffixFixture(
    size,
    async (history) => {
      if (created === undefined) throw new Error('Missing fault history');
      const { handler } = highdensitySetup(history, undefined, async () => {
        throw new Error('hook fail-open');
      });
      const started = deferred();
      const pause = deferred();
      created.beforeEstimate = async () => {
        started.resolve();
        await pause.promise;
      };
      const attempt = handler.performCompression('pinned');
      await started.promise;
      const queued: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'queued during disk high-density' }],
      };
      history.add(queued);
      created.beforeEstimate = undefined;
      pause.resolve();
      expect(await attempt).toBe(PerformCompressionResult.COMPRESSED);
      const rows = await collectRows(history);
      expect(rows[rows.length - 1]?.blocks).toStrictEqual(queued.blocks);
      expect(
        rows.filter((row) =>
          row.blocks.some(
            (block) =>
              block.type === 'text' &&
              block.text === 'queued during disk high-density',
          ),
        ),
      ).toHaveLength(1);
      return rows.length;
    },
    64,
    highdensityRow,
    undefined,
    (options) => {
      created = new HighdensityFaultHistory(options);
      return created;
    },
  );
}

describe('disk high-density atomicity and queued append', () => {
  it.each([65])(
    'pins %i rows during estimation and flushes queued appends after hook failure',
    async (size) => {
      expect(await pinned(size)).toBeGreaterThan(0);
    },
    180_000,
  );
  it('preserves a valid nine-MiB tail row without applying the owner budget as a row limit', async () => {
    const huge = 'L'.repeat(9 * 1024 * 1024);
    await withSuffixFixture(
      512,
      async (history) => {
        const { handler } = highdensitySetup(history);
        expect(await handler.performCompression('huge')).toBe(
          PerformCompressionResult.COMPRESSED,
        );
        const rows = await collectRows(history);
        expect(rows[rows.length - 1]?.blocks).toStrictEqual([
          { type: 'text', text: huge },
        ]);
      },
      64,
      (index, bytes) =>
        index === 511
          ? {
              ...highdensityRow(index, bytes),
              speaker: 'human',
              blocks: [{ type: 'text', text: huge }],
            }
          : highdensityRow(index, bytes),
      undefined,
      (options) => new HighdensityDiskHistory(options),
    );
  }, 180_000);
});
