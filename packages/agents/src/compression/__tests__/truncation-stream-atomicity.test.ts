/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  withRollbackFixture,
  expectedRange,
} from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  truncationHandler,
  truncationRow,
  collectRows,
  TruncationStreamHistory,
} from './truncation-stream-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

async function rollback(size: number): Promise<PerformCompressionResult> {
  return withRollbackFixture(async (history, recorder) => {
    const handler = truncationHandler(history);
    for (let index = 0; index < size; index++)
      history.add(truncationRow(index, 64));
    await history.waitForTokenUpdates();
    await recorder.flush();
    history.setCacheAnchorSeq(1);
    const original = Array.from({ length: size }, (_, index) =>
      truncationRow(index, 64),
    );
    recorder.failAdmissionAfter(2);
    await expect(handler.performCompression('rollback')).rejects.toThrow(
      'injected journal admission failure',
    );
    expect(await collectRows(history)).toStrictEqual(original);
    expect(history.getContextRange()).toStrictEqual(expectedRange(size));
    expect(history.getCacheAnchorSeq()).toBe(1);
    const result = await handler.performCompression('retry');
    expect(result).toBe(PerformCompressionResult.COMPRESSED);
    return result;
  });
}

describe('disk truncation atomicity and caller ownership', () => {
  it.each([512, 8192])(
    'restores all %i durable rows after partial candidate admission',
    async (size) => {
      expect(await rollback(size)).toBe(PerformCompressionResult.COMPRESSED);
    },
    120_000,
  );

  it('does not stamp strongly held caller rows or replace their marker objects on failure', async () => {
    await withRollbackFixture(async (history, recorder, release) => {
      const handler = truncationHandler(history);
      const callers = Array.from({ length: 512 }, (_, index) =>
        truncationRow(index, 64),
      );
      for (const row of callers) history.add(row);
      await history.waitForTokenUpdates();
      const markers = callers.map((row) => row.metadata?.chronology);
      const values = JSON.stringify(
        Array.from({ length: 512 }, (_, index) => truncationRow(index, 64)),
      );
      release();
      await recorder.flush();
      recorder.failAdmissionAfter(1);
      await expect(handler.performCompression('strong')).rejects.toThrow(
        'injected journal admission failure',
      );
      expect(JSON.stringify(callers)).toBe(values);
      expect(
        callers.every(
          (row, index) => row.metadata?.chronology === markers[index],
        ),
      ).toBe(true);
      release();
    }, true);
  }, 120_000);

  it('preserves and annotates a surviving summary while recording it as the compression summary', async () => {
    await withSuffixFixture(
      512,
      async (history) => {
        const handler = truncationHandler(history);
        history.syncTotalTokens(512);
        await history.waitForTokenUpdates();
        let recordingSummary: IContent | undefined;
        history.on('compressionEnded', (summary) => {
          recordingSummary = summary;
        });
        expect(await handler.performCompression('summary')).toBe(
          PerformCompressionResult.COMPRESSED,
        );
        expect(recordingSummary?.metadata?.chronologyReplaced).toStrictEqual({
          fromSeq: 1,
          toSeq: 483,
          itemCount: 483,
        });
        expect(recordingSummary?.metadata?.reason).toBe(
          'compression-state-snapshot',
        );
      },
      64,
      (index) => ({
        ...truncationRow(index, 64),
        ...(index === 490
          ? {
              speaker: 'ai',
              metadata: {
                ...truncationRow(index, 64).metadata,
                isSummary: true,
                reason: 'compression-state-snapshot',
              },
            }
          : {}),
      }),
      undefined,
      (options) => new TruncationStreamHistory(options),
    );
  });
});
