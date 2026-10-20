/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { exactTokenizer } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
import { compressionValueDigest } from '../compression-value-fixture.js';
import {
  middleoutSetup,
  middleoutOracle,
  middleoutRow,
} from '../middleout-disk-helpers.js';
import { oneshotSetup, oneshotOracle } from '../oneshot-disk-helpers.js';
import { collectRows } from '../truncation-stream-helpers.js';
import {
  withNativeFallbackFixture,
  reachesGate,
} from './native-fallback-fixture.js';

export async function nativeSummaryPublication(
  size: number,
  strategy: 'middle-out' | 'one-shot',
): Promise<number> {
  let liveRows = 0;
  await withNativeFallbackFixture(async (fixture) => {
    const { history, owners, durable } = fixture;
    forbidHistoryMaterializationForTest(
      history,
      'eager summary publication forbidden',
    );
    await fixture.seed(
      (function* () {
        for (let index = 0; index < size; index++) yield middleoutRow(index);
      })(),
    );
    const setup = strategy === 'middle-out' ? middleoutSetup : oneshotSetup;
    const oracle = strategy === 'middle-out' ? middleoutOracle : oneshotOracle;
    const expected = await oracle(history, size);
    const { handler, transport } = setup(history);
    history.setCacheAnchorSeq(1);
    const before = await compressionValueDigest(history.streamRawHistory());
    const tokens = history.getTotalTokens();
    const range = history.getContextRange();
    const primary = new Error(`paused ${strategy} publication`);
    await fixture.pauseFinalization(primary);
    fixture.pauseWriter();
    const operation = handler.performCompression('owner-pause').then(
      () => undefined,
      (failure: unknown) => failure,
    );
    try {
      await reachesGate(fixture.writerPaused, operation);
      liveRows = owners.snapshot().liveRows;
      expect(liveRows).toBeGreaterThan(0);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      fixture.releaseWriter();
      await reachesGate(fixture.acknowledged, operation);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(owners.snapshot().liveSerializedBytes).toBe(0);
      const published = await durable(false);
      expect(published.count).toBe(expected.rows.length);
      expect(published).not.toStrictEqual(before);
    } finally {
      fixture.releaseWriter();
      fixture.releaseFinalization();
    }
    expect(await operation).toBe(primary);
    expect(
      await compressionValueDigest(history.streamRawHistory()),
    ).toStrictEqual(before);
    expect(await durable()).toStrictEqual(before);
    expect(await collectRows(history)).toStrictEqual(
      Array.from({ length: size }, (_, index) => middleoutRow(index)),
    );
    expect(history.getTotalTokens()).toBe(tokens);
    expect(history.getContextRange()).toStrictEqual(range);
    expect(history.getCacheAnchorSeq()).toBe(1);
    expect(await handler.performCompression('owner-retry')).toBe(
      PerformCompressionResult.COMPRESSED,
    );
    expect(transport.requests).toStrictEqual([
      expected.requests[0],
      expected.requests[0],
    ]);
    expect(await durable()).toStrictEqual(
      await compressionValueDigest(history.streamRawHistory()),
    );
    expect(owners.snapshot().liveRows).toBe(0);
    expect(owners.snapshot().liveSerializedBytes).toBe(0);
  });
  return liveRows;
}

export async function nativeSummaryAdmissionRollback(
  size: number,
): Promise<number> {
  let requests = 0;
  await withNativeFallbackFixture(
    async ({ history, seed, durable, owners, failAdmissionAfter }) => {
      const callers = Array.from({ length: size }, (_, index): IContent => {
        const row = middleoutRow(index, 64);
        return row.blocks.length === 0
          ? {
              ...row,
              blocks: [{ type: 'text', text: `empty-ai-${index}` }],
            }
          : row;
      });
      const markers = callers.map((row) => row.metadata?.chronology);
      await seed(callers);
      const { handler, transport } = middleoutSetup(history);
      history.setCacheAnchorSeq(1);
      const before = await compressionValueDigest(history.streamRawHistory());
      const tokens = history.getTotalTokens();
      const range = history.getContextRange();
      const failure = failAdmissionAfter(2);
      const result = await handler.performCompression('rollback').then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(result).toBe(failure);
      expect(
        await compressionValueDigest(history.streamRawHistory()),
      ).toStrictEqual(before);
      expect(await durable()).toStrictEqual(before);
      expect(history.getContextRange()).toStrictEqual(range);
      expect(history.getTotalTokens()).toBe(tokens);
      expect(history.getCacheAnchorSeq()).toBe(1);
      expect(
        callers.every(
          (row, index) => row.metadata?.chronology === markers[index],
        ),
      ).toBe(true);
      history.setTokenizerFactory(exactTokenizer());
      expect(await handler.performCompression('retry')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      expect(await durable()).toStrictEqual(
        await compressionValueDigest(history.streamRawHistory()),
      );
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      expect(owners.snapshot().liveRows).toBe(0);
      requests = transport.requests.length;
    },
  );
  return requests;
}
