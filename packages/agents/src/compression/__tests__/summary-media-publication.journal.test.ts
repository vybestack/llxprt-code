/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { detachedDigest } from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import { withNativeDetachedFixture } from '@vybestack/llxprt-code-core/services/history/__tests__/support/detached-contract-fixture.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
import { middleoutSetup } from './middleout-disk-helpers.js';
import { oneshotSetup } from './oneshot-disk-helpers.js';
import { buildCompressionSystemInstruction } from '../compressionSystemPrompt.js';

class RejectingMediaOwner extends HistoryMediaOwnership {
  failure: Error | undefined;
  override prepareReferenceReplacement(
    ...args: Parameters<HistoryMediaOwnership['prepareReferenceReplacement']>
  ): ReturnType<HistoryMediaOwnership['prepareReferenceReplacement']> {
    const effect = super.prepareReferenceReplacement(...args);
    return {
      publish: () => effect.publish(),
      rollback: () => effect.rollback(),
      finalize: async () => {
        const failure = this.failure;
        this.failure = undefined;
        if (failure !== undefined) throw failure;
        await effect.finalize?.();
      },
    };
  }
}

describe('native summary publication media lifetime', () => {
  const directory = useTempDir('summary-media-publication-');
  const cases = ['middle-out', 'one-shot'].flatMap((strategy) =>
    [512, 8192].map((size) => ({ strategy, size })),
  );
  for (const { strategy, size } of cases) {
    it(`${strategy} retains media on cancellation and finalization rejection, then releases it on retry at ${size} rows`, async () => {
      await buildCompressionSystemInstruction('test-model', {
        provider: 'summary-transport',
        interactionMode: 'non-interactive',
      });
      const media = new LocalMediaStore({
        rootDirectory: directory(),
        quotaBytes: 1024,
      });
      try {
        await withNativeDetachedFixture(
          async ({ history, owners, durable }) => {
            forbidHistoryMaterializationForTest(
              history,
              'eager summary media forbidden',
            );
            const reference = await media.admit({
              bytes: new Uint8Array([1]),
              mimeType: 'application/octet-stream',
              semanticMetadata: {},
            });
            const owner = new RejectingMediaOwner(media);
            await history.registerMediaOwner(owner);
            await history.detachedValues.replace(
              (function* () {
                for (let index = 0; index < size; index++) {
                  const row = suffixRow(index, 2048);
                  yield index === Math.floor(size / 2)
                    ? { ...row, blocks: [...row.blocks, reference] }
                    : row;
                }
              })(),
            );
            const { handler, transport } =
              strategy === 'middle-out'
                ? middleoutSetup(history)
                : oneshotSetup(history);
            history.setBaseTokenOffset(37);
            history.setCacheAnchorSeq(1);
            const before = await detachedDigest(history.streamRawHistory());
            const tokens = history.getTotalTokens();
            const range = history.getContextRange();
            transport.failure = new DOMException(
              'summary media cancellation',
              'AbortError',
            );
            await expect(handler.performCompression('cancel')).rejects.toThrow(
              'summary media cancellation',
            );
            expect(await media.hasReservations(reference.contentId)).toBe(true);
            expect(
              await detachedDigest(history.streamRawHistory()),
            ).toStrictEqual(before);
            expect(await durable()).toStrictEqual(before);
            expect(owners.snapshot().liveRows).toBe(0);
            transport.failure = undefined;
            const failure = new Error(
              'summary publication finalization rejected',
            );
            owner.failure = failure;
            const rejected = await handler.performCompression('finalize').then(
              () => undefined,
              (error: unknown) => error,
            );
            expect(rejected).toBe(failure);
            expect(await media.hasReservations(reference.contentId)).toBe(true);
            expect(
              await detachedDigest(history.streamRawHistory()),
            ).toStrictEqual(before);
            expect(await durable()).toStrictEqual(before);
            expect(history.getTotalTokens()).toBe(tokens);
            expect(history.getBaseTokenOffset()).toBe(37);
            expect(history.getCacheAnchorSeq()).toBe(1);
            expect(history.getContextRange()).toStrictEqual(range);
            expect(owners.snapshot().liveRows).toBe(0);
            expect(owners.snapshot().liveSerializedBytes).toBe(0);
            expect(await handler.performCompression('retry')).toBe(
              PerformCompressionResult.COMPRESSED,
            );
            expect(await media.hasReservations(reference.contentId)).toBe(
              false,
            );
            expect(transport.requests).toStrictEqual([
              transport.requests[0],
              transport.requests[0],
              transport.requests[0],
            ]);
            expect(await durable()).toStrictEqual(
              await detachedDigest(history.streamRawHistory()),
            );
            expect(
              owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
            ).toBe(true);
            expect(owners.snapshot().liveRows).toBe(0);
          },
        );
      } finally {
        await media.close();
      }
    }, 180_000);
  }
});
