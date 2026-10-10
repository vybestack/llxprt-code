/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { installFixtureCandidate } from './provider-fallback-candidate-fixture.js';
import { describe, expect, it } from 'bun:test';
import {
  withFallbackFixture,
  fallbackHarness,
  fallbackCandidate,
  enforceFallback,
} from './provider-fallback-disk-helpers.js';
import { digestRows } from './tool-truncation-stream-helpers.js';

const cases = [512, 8192].flatMap((size) =>
  ['throw', 'false', 'baseline', 'partial', 'cancel'].map((failure) => ({
    size,
    failure,
  })),
);

describe('provider fallback durable snapshot and compensation', () => {
  it.each(cases)(
    'restores $size mixed rows after $failure rejection',
    async ({ size, failure }) => {
      await withFallbackFixture(
        size,
        async ({ history, recorder, before, reads, owners }) => {
          const tokens = history.getTotalTokens();
          const harness = fallbackHarness(
            history,
            async (_promptId, install) => {
              if (failure === 'partial') recorder.failAdmissionAfter(1);
              await installFixtureCandidate(install, [fallbackCandidate()]);
              if (failure === 'throw') throw new Error('bookkeeping failed');
              if (failure === 'cancel') {
                const controller = new AbortController();
                controller.abort(new Error('request cancelled after install'));
                controller.signal.throwIfAborted();
              }
              return failure !== 'false';
            },
            { resetFails: failure === 'baseline' },
          );
          await expect(enforceFallback(harness)).rejects.toThrow(
            /post-truncation stage/,
          );
          expect(await digestRows(history.streamRawHistory())).toBe(before);
          expect(history.getTotalTokens() - tokens).toBe(0);
          expect(history.getBaseTokenOffset()).toBe(37);
          expect(history.getCacheAnchorSeq()).toBe(1);
          expect(harness.baseline()).toBe(123);
          expect(reads.snapshot().peakDecodedRows).toBeLessThanOrEqual(440);
          expect(
            owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
          expect(owners.snapshot().liveRows).toBe(0);
        },
      );
    },
  );
});

describe('provider fallback successful installation', () => {
  it.each([512, 8192])(
    'accepts a successful candidate over $size rows without an eager snapshot',
    async (size) => {
      await withFallbackFixture(size, async ({ history, recorder }) => {
        const candidate = fallbackCandidate();
        const harness = fallbackHarness(
          history,
          async (_promptId, install) => {
            await installFixtureCandidate(install, [candidate]);
            return true;
          },
          { fits: true },
        );
        const result = await enforceFallback(harness);
        expect(result.map((row) => row.blocks)).toStrictEqual([
          candidate.blocks,
          [{ type: 'text', text: 'pending' }],
        ]);
        await recorder.flush();
        expect(history.getCacheAnchorSeq()).toBe(0);
        expect(harness.baseline()).toBeNull();
        expect(result[0].metadata?.chronology?.seq).toBe(size + 1);
      });
    },
  );

  it('accepts a valid candidate row larger than eight MiB', async () => {
    await withFallbackFixture(1, async ({ history }) => {
      const candidate = fallbackCandidate(9 * 1024 * 1024);
      const harness = fallbackHarness(
        history,
        async (_promptId, install) => {
          await installFixtureCandidate(install, [candidate]);
          return true;
        },
        { fits: true },
      );
      const result = await enforceFallback(harness);
      expect(result[0].blocks).toStrictEqual(candidate.blocks);
      expect(JSON.stringify(result[0]).length).toBeGreaterThan(8 * 1024 * 1024);
    });
  });
});
