/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { CompressionExecutionError } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { expectedRange } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  highdensitySetup,
  highdensityRow,
} from './highdensity-disk-helpers.js';
import {
  HighdensityFaultHistory,
  withFaultRollback,
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

async function rollback(size: number): Promise<number> {
  return withFaultRollback(async (history, recorder) => {
    const { handler } = highdensitySetup(history, undefined, undefined, {
      contextLimit: 1000,
    });
    const callers = Array.from({ length: size }, (_, index) =>
      admissionRow(index),
    );
    const markers = callers.map((row) => row.metadata?.chronology);
    for (const row of callers) history.add(row);
    await history.waitForTokenUpdates();
    await recorder.flush();
    history.setCacheAnchorSeq(2);
    let failures = 3;
    history.estimateFault = () =>
      failures-- > 0
        ? new CompressionExecutionError(
            'high-density',
            '503 fallback rollback trigger',
            { isTransient: true },
          )
        : undefined;
    recorder.failAdmissionAfter(2);
    expect(await handler.performCompression('rollback')).toBe(
      PerformCompressionResult.FAILED,
    );
    expect(await collectRows(history)).toStrictEqual(
      Array.from({ length: size }, (_, index) => admissionRow(index)),
    );
    expect(history.getContextRange()).toStrictEqual(expectedRange(size));
    expect(history.getCacheAnchorSeq()).toBe(2);
    gcAndSweep();
    expect(
      callers.every(
        (row, index) => row.metadata?.chronology === markers[index],
      ),
    ).toBe(true);
    expect(handler.wasRecentlyCompressed()).toBe(false);
    history.estimateFault = undefined;
    expect(await handler.performCompression('retry')).toBe(
      PerformCompressionResult.COMPRESSED,
    );
    return size;
  });
}

async function failedOrNoop(size: number): Promise<number> {
  let created: HighdensityFaultHistory | undefined;
  return withSuffixFixture(
    size,
    async (history) => {
      if (created === undefined) throw new Error('Missing fault participant');
      const { handler } = highdensitySetup(history, undefined, undefined, {
        contextLimit: 1,
      });
      created.estimateFault = () =>
        new CompressionExecutionError(
          'high-density',
          '503 primary exhaustion',
          { isTransient: true },
        );
      // A fresh attached journal has no token baseline until explicit recomputation.
      expect(await handler.performCompression('fallback-noop')).toBe(
        PerformCompressionResult.NOOP,
      );
      created.estimateFault = undefined;
      await history.recalculateTotalTokens();
      created.estimateFault = () =>
        new CompressionExecutionError(
          'high-density',
          '503 fallback estimate failure',
          { isTransient: true },
        );
      expect(await handler.performCompression('both-failed')).toBe(
        PerformCompressionResult.FAILED,
      );
      expect(await collectRows(history)).toStrictEqual(
        Array.from({ length: size }, (_, index) => highdensityRow(index, 64)),
      );
      expect(handler.wasRecentlyCompressed()).toBe(false);
      return size;
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

describe('high-density disk fallback outcomes and compensation', () => {
  it.each([512, 8192])(
    'restores %i rows and caller markers after partial fallback admission',
    async (size) => {
      expect(await rollback(size)).toBe(size);
    },
    180_000,
  );
  it.each([512, 8192])(
    'keeps %i rows unchanged on fallback no-op and failed estimation',
    async (size) => {
      expect(await failedOrNoop(size)).toBe(size);
    },
    180_000,
  );
});
