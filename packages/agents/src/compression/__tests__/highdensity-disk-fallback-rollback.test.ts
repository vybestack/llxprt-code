/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { CompressionExecutionError } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { expectedRange } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { withCoreSuffixFixture } from '../../../../core/src/services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import { compressionValueDigest } from './compression-value-fixture.js';
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
    await history.addBatch(callers);
    await history.waitForTokenUpdates();
    await recorder.flush();
    const before = await recorder.durable();
    const tokens = history.getTotalTokens();
    const offset = history.getBaseTokenOffset();
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
    expect(history.getTotalTokens()).toBe(tokens);
    expect(history.getBaseTokenOffset()).toBe(offset);
    expect(await recorder.durable()).toStrictEqual(before);
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
  return withCoreSuffixFixture(
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
    'old',
  );
}

async function admittedFallback(size: number): Promise<number> {
  return withFaultRollback(async (history, recorder) => {
    const { handler, runtime } = highdensitySetup(history);
    await history.detachedValues.replace(
      (function* () {
        for (let index = 0; index < size; index++) yield admissionRow(index);
      })(),
    );
    const tokens = history.getTotalTokens();
    runtime.ephemerals.contextLimit = () =>
      Math.ceil(tokens / (runtime.ephemerals.compressionThreshold() * 0.6)) + 1;
    const before = await recorder.durable();
    history.estimateFault = () =>
      new CompressionExecutionError(
        'high-density',
        '503 native primary exhaustion',
        {
          isTransient: true,
        },
      );
    expect(await handler.performCompression('admitted-fallback-noop')).toBe(
      PerformCompressionResult.NOOP,
    );
    history.estimateFault = undefined;
    await history.recalculateTotalTokens();
    expect(history.getTotalTokens()).toBe(tokens);
    runtime.ephemerals.contextLimit = () => 1;
    history.estimateFault = () =>
      new CompressionExecutionError(
        'high-density',
        '503 admitted fallback estimate',
        {
          isTransient: true,
        },
      );
    expect(await handler.performCompression('admitted-both-failed')).toBe(
      PerformCompressionResult.FAILED,
    );
    expect(
      await compressionValueDigest(history.streamRawHistory()),
    ).toStrictEqual(before);
    expect(await recorder.durable()).toStrictEqual(before);
    expect(history.getContextRange()).toStrictEqual(expectedRange(size));
    expect(handler.wasRecentlyCompressed()).toBe(false);
    return size;
  });
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
  it.each([512, 8192])(
    'preserves %i admitted rows across under-budget fallback no-op and over-budget estimation failure',
    async (size) => {
      expect(await admittedFallback(size)).toBe(size);
    },
    180_000,
  );
});
