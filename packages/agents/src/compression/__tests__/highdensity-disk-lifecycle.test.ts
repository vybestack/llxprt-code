/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withSuffixFixture } from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import {
  withRollbackFixture,
  expectedRange,
} from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  highdensitySetup,
  highdensityRow,
  HighdensityDiskHistory,
} from './highdensity-disk-helpers.js';
import {
  HighdensityFaultHistory,
  deferred,
} from './highdensity-disk-fault-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';
const { gcAndSweep }: { gcAndSweep: () => void } = createRequire(
  import.meta.url,
)('bun:jsc');

function admissionRow(index: number): IContent {
  const row = highdensityRow(index, 64);
  return row.blocks.length === 0
    ? { ...row, blocks: [{ type: 'text', text: `empty-ai-${index}` }] }
    : row;
}

async function rollback(size: number): Promise<PerformCompressionResult> {
  return withRollbackFixture(async (history, recorder) => {
    const { handler, transport } = highdensitySetup(history);
    const callers = Array.from({ length: size }, (_, index) =>
      admissionRow(index),
    );
    const markers = callers.map((row) => row.metadata?.chronology);
    for (const row of callers) history.add(row);
    await history.waitForTokenUpdates();
    await recorder.flush();
    history.setCacheAnchorSeq(2);
    const expected = Array.from({ length: size }, (_, index) =>
      admissionRow(index),
    );
    recorder.failAdmissionAfter(2);
    await expect(handler.performCompression('rollback')).rejects.toThrow(
      'injected journal admission failure',
    );
    expect(await collectRows(history)).toStrictEqual(expected);
    expect(history.getContextRange()).toStrictEqual(expectedRange(size));
    expect(history.getCacheAnchorSeq()).toBe(2);
    gcAndSweep();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(
      callers.every(
        (row, index) => row.metadata?.chronology === markers[index],
      ),
    ).toBe(true);
    const result = await handler.performCompression('retry');
    expect(result).toBe(PerformCompressionResult.COMPRESSED);
    expect(transport.requests).toHaveLength(0);
    return result;
  });
}

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
  it.each([512, 8192])(
    'restores all %i rows, chronology and caller marker identity after partial admission',
    async (size) => {
      expect(await rollback(size)).toBe(PerformCompressionResult.COMPRESSED);
    },
    180_000,
  );
  it.each([512, 8192])(
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
