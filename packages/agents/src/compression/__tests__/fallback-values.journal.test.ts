/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DetachedHistoryJournal } from '@vybestack/llxprt-code-core/services/history/detachedHistoryJournal.js';
import { transformFixtureRows } from '@vybestack/llxprt-code-core/services/history/__tests__/support/transform-value-fixtures-test-helpers.js';
import { withNativeValueFixture } from './support/native-value-fixture.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import {
  fallbackHarness,
  enforceFallback,
  fallbackCandidate,
} from './provider-fallback-disk-helpers.js';
import { publishProviderFallbackCandidate } from '../providerFallbackCandidate.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';

const failures = [
  'reject',
  'false',
  'cancel',
  'baseline',
  'duplicate',
  'missing',
] as const;

const cases = [512, 8192].flatMap((size) =>
  failures.map((failure) => ({ size, failure })),
);

describe('native persisted fallback value compensation', () => {
  for (const { size, failure } of cases) {
    it(`restores ${size} complete media/tool/provider rows after ${failure}`, async () => {
      await withNativeValueFixture(async ({ history, durable, owners }) => {
        await history.detachedValues.replace(transformFixtureRows(size));
        const before = await compressionValueDigest(transformFixtureRows(size));
        history.setBaseTokenOffset(37);
        history.setCacheAnchorSeq(1);
        const rows = new DetachedHistoryJournal(owners);
        try {
          rows.append(fallbackCandidate());
          const harness = fallbackHarness(
            history,
            async (_prompt, install) => {
              if (failure === 'missing') return true;
              await install({ rows, start: 0, hasPendingRows: true });
              if (failure === 'duplicate')
                await install({ rows, start: 0, hasPendingRows: true });
              if (failure === 'reject') throw new Error('fallback rejected');
              if (failure === 'cancel')
                throw new DOMException(
                  'cancelled after installation',
                  'AbortError',
                );
              return failure !== 'false';
            },
            { resetFails: failure === 'baseline' },
          );
          let message = 'post-truncation stage';
          if (failure === 'missing')
            message = 'without providing candidate history';
          if (failure === 'duplicate') message = 'only be installed once';
          await expect(enforceFallback(harness)).rejects.toThrow(message);
          expect(await durable()).toStrictEqual(before);
          expect(
            await compressionValueDigest(history.streamRawHistory()),
          ).toStrictEqual(before);
          expect(history.getTotalTokens()).toBe(size * 3 + 37);
          expect(history.getBaseTokenOffset()).toBe(37);
          expect(history.getCacheAnchorSeq()).toBe(1);
          expect(harness.baseline()).toBe(123);
          expect(owners.snapshot().liveRows).toBe(0);
          expect(
            owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
        } finally {
          rows.close();
        }
      });
    }, 180_000);
  }

  it('persists a complete candidate larger than nine MiB without a row-size fallback', async () => {
    await withNativeValueFixture(async ({ history, durable, owners }) => {
      const rows = new DetachedHistoryJournal(owners);
      try {
        const candidate = suffixRow(0, 9 * 1024 * 1024 + 1);
        rows.append(candidate);
        await publishProviderFallbackCandidate(
          history,
          { rows, start: 0, hasPendingRows: false },
          'test',
        );
        const expected = await compressionValueDigest(
          (async function* () {
            yield candidate;
          })(),
        );
        expect(expected.bytes).toBeGreaterThan(9 * 1024 * 1024);
        expect(await durable()).toStrictEqual(expected);
        expect(
          await compressionValueDigest(history.streamRawHistory()),
        ).toStrictEqual(expected);
        expect(owners.snapshot().liveRows).toBe(0);
      } finally {
        rows.close();
      }
    });
  }, 180_000);
});
