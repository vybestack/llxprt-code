/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import {
  exactTokenizer,
  rejectedValue,
} from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import {
  densityHandler,
  densityRow,
  densityOracle,
  digestRows,
  digestStream,
} from '../density-disk-helpers.js';
import { compressionValueDigest } from '../compression-value-fixture.js';
import { withNativeFallbackFixture } from './native-fallback-fixture.js';

export async function nativeDensityRollback(size: number): Promise<number> {
  let surviving = 0;
  await withNativeFallbackFixture(
    async ({ history, owners, durable, failAdmissionAfter }) => {
      const handler = densityHandler(history);
      await history.detachedValues.replace(
        (function* () {
          for (let index = 0; index < size; index++) yield densityRow(index);
        })(),
      );
      history.setBaseTokenOffset(37);
      history.setCacheAnchorSeq(2);
      const before = await compressionValueDigest(history.streamRawHistory());
      expect(before.count).toBe(size);
      expect(await durable()).toStrictEqual(before);
      const tokens = history.getTotalTokens();
      const range = history.getContextRange();
      const failure = failAdmissionAfter(2);
      expect(await rejectedValue(handler.ensureDensityOptimized())).toBe(
        failure,
      );
      expect(
        await compressionValueDigest(history.streamRawHistory()),
      ).toStrictEqual(before);
      expect(await durable()).toStrictEqual(before);
      expect(history.getTotalTokens()).toBe(tokens);
      expect(history.getBaseTokenOffset()).toBe(37);
      expect(history.getCacheAnchorSeq()).toBe(2);
      expect(history.getContextRange()).toStrictEqual(range);
      expect(handler.densityDirty).toBe(false);
      history.setTokenizerFactory(exactTokenizer());
      handler.markDensityDirty();
      await handler.ensureDensityOptimized();
      expect(await digestStream(history.streamRawHistory())).toBe(
        digestRows(densityOracle(size)),
      );
      expect(await durable()).toStrictEqual(
        await compressionValueDigest(history.streamRawHistory()),
      );
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(owners.snapshot().liveSerializedBytes).toBe(0);
      surviving = (await compressionValueDigest(history.streamRawHistory()))
        .count;
    },
  );
  return surviving;
}

export async function nativeDensityPublication(): Promise<number> {
  let restored = 0;
  await withNativeFallbackFixture(async ({ history, durable, owners }) => {
    const callers = Array.from({ length: 12 }, (_, index) =>
      densityRow(index, 0),
    );
    const marker = structuredClone(callers[0].metadata?.chronology);
    await history.addBatch(callers);
    const before = await compressionValueDigest(history.streamRawHistory());
    const tokens = history.getTotalTokens();
    const failure = new Error('native density publication rejected');
    history.once('tokensUpdated', () => {
      callers[0].metadata = {
        chronology: { seq: 900, userTurn: 99, step: 2, recordedAt: 0 },
      };
      throw failure;
    });
    const handler = densityHandler(history);
    expect(await rejectedValue(handler.ensureDensityOptimized())).toBe(failure);
    expect(
      await compressionValueDigest(history.streamRawHistory()),
    ).toStrictEqual(before);
    expect(await durable()).toStrictEqual(before);
    for await (const row of history.streamRawHistory()) {
      expect(row).not.toBe(callers[0]);
      expect(row.metadata?.chronology).toStrictEqual(marker);
      break;
    }
    expect(history.getTotalTokens()).toBe(tokens);
    expect(handler.densityDirty).toBe(false);
    expect(owners.snapshot().liveRows).toBe(0);
    restored = (await compressionValueDigest(history.streamRawHistory())).count;
  });
  return restored;
}
