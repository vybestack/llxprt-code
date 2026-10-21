/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  withRollbackFixture,
  durableRowsOf,
} from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { withNativeValueFixture } from './support/native-value-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import { publishProviderFallbackCandidate } from '../providerFallbackCandidate.js';
import {
  fallbackRow,
  nativeFallback,
} from './native-provider-fallback-helpers.js';

function snapshot(index: number, reason?: string): IContent {
  return {
    ...fallbackRow(index),
    metadata: {
      ...fallbackRow(index).metadata,
      isSummary: true,
      ...(reason ? { reason } : {}),
    },
  };
}

describe('indexed native fallback value and summary contracts', () => {
  for (const size of [512, 8192]) {
    it(`matches independent old fallback and eager surviving rows at ${size}`, async () => {
      await withNativeValueFixture(async ({ history, durable }) => {
        await withRollbackFixture(async (old, recorder) => {
          const input = Array.from({ length: size }, (_, index) =>
            fallbackRow(index),
          );
          await history.detachedValues.replace(input);
          await old.detachedValues.replace(input);
          await history.waitForCommit();
          await recorder.flush();
          const oldResult = await nativeFallback(old, size / 2);
          const creates = await operationFileCreates(async () => {
            expect(await nativeFallback(history, size / 2)).toStrictEqual(
              oldResult,
            );
          }, true);
          expect(creates).toStrictEqual({ directories: [], files: [] });
          const actual = await Array.fromAsync(history.streamRawHistory());
          const oldRows = await Array.fromAsync(old.streamRawHistory());
          const expected = input.slice(size / 2).map((content) => ({
            ...content,
            metadata: Object.fromEntries(
              Object.entries(content.metadata ?? {}).filter(
                ([key]) => key !== 'responsesStored',
              ),
            ),
          }));
          expect(actual).toStrictEqual(expected);
          expect(actual).toStrictEqual(oldRows);
          expect(history.getTotalTokens()).toBe(size / 2);
          expect(history.getTotalTokens()).toBe(old.getTotalTokens());
          expect(history.getContextRange()).toStrictEqual(
            old.getContextRange(),
          );
          expect(await durable()).toStrictEqual(
            await compressionValueDigest(expected),
          );
          await recorder.flush();
          expect(await durableRowsOf(recorder)).toStrictEqual(expected);
        });
      });
    }, 180_000);
  }

  for (const size of [0, 1, 2, 8]) {
    it(`does not create candidates, read rows or publish when ${size} rows are under target`, async () => {
      await withNativeValueFixture(async ({ history }) => {
        await history.detachedValues.replace(
          Array.from({ length: size }, (_, index) => fallbackRow(index)),
        );
        await history.waitForCommit();
        if (size > 0) history.setCacheAnchorSeq(1);
        const before = await compressionValueDigest(history.streamRawHistory());
        const creates = await operationFileCreates(async () => {
          expect(
            await nativeFallback(history, size, async () => {
              throw new Error('no-op attempted publication');
            }),
          ).toStrictEqual({ outcome: 'noop' });
        }, true);
        expect(creates).toStrictEqual({ directories: [], files: [] });
        expect(
          await compressionValueDigest(history.streamRawHistory()),
        ).toStrictEqual(before);
        expect(history.getCacheAnchorSeq()).toBe(size > 0 ? 1 : 0);
      });
    });
  }

  it('prefers the first surviving compression-state snapshot over earlier summary markers and excludes pending rows', async () => {
    await withNativeValueFixture(async ({ history }) => {
      const input = [
        fallbackRow(0),
        snapshot(1),
        snapshot(2, 'compression-state-snapshot'),
        snapshot(3, 'compression-state-snapshot'),
        fallbackRow(4),
      ];
      await history.detachedValues.replace(input);
      const result = await nativeFallback(history, 4, async (candidate) => {
        expect(candidate.start).toBe(1);
        expect(candidate.hasPendingRows).toBe(false);
        expect(await candidate.sourceOrdinalAt?.(0)).toBe(0);
        expect(await candidate.sourceOrdinalAt?.(2)).toBe(2);
        await Promise.resolve();
        await publishProviderFallbackCandidate(
          history,
          candidate,
          'test-model',
        );
      });
      expect(result.summary).toStrictEqual(input[2]);
      expect(await Array.fromAsync(history.streamRawHistory())).toHaveLength(4);
    });
  });

  it('keeps the first legacy synthetic snapshot when no reason-marked summary survives', async () => {
    await withNativeValueFixture(async ({ history }) => {
      const synthetic: IContent = {
        ...fallbackRow(1),
        blocks: [
          { type: 'text', text: '<state_snapshot>legacy</state_snapshot>' },
        ],
        metadata: { ...fallbackRow(1).metadata, synthetic: true },
      };
      await history.detachedValues.replace([
        fallbackRow(0),
        synthetic,
        snapshot(2),
        fallbackRow(3),
      ]);
      expect((await nativeFallback(history, 3)).summary).toStrictEqual(
        synthetic,
      );
    });
  });

  it('preserves the complete surviving value larger than nine MiB and its durable mirror', async () => {
    await withNativeValueFixture(async ({ history, durable }) => {
      const text = 'abcdefghijk'
        .repeat(Math.ceil((9 * 1024 * 1024 + 17) / 11))
        .slice(0, 9 * 1024 * 1024 + 17);
      const large: IContent = {
        ...fallbackRow(3),
        blocks: [{ type: 'text', text }],
      };
      await history.detachedValues.replace([
        fallbackRow(0),
        fallbackRow(1),
        fallbackRow(2),
        large,
      ]);
      await history.waitForCommit();
      await operationFileCreates(async () => {
        await nativeFallback(history, 2);
      }, true);
      const rows = await Array.fromAsync(history.streamRawHistory());
      expect(rows[1].blocks).toStrictEqual([{ type: 'text', text }]);
      expect(await durable()).toStrictEqual(await compressionValueDigest(rows));
    });
  }, 180_000);
});
