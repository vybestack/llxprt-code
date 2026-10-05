/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { withFallbackFixture } from './provider-fallback-disk-helpers.js';

const cases = [512, 8192].flatMap((size) =>
  [false, true].map((copy) => ({ size, copy })),
);
describe('fallback snapshot retaining controls', () => {
  it.each(cases)(
    'detects all $size retained rows copy=$copy',
    async ({ size, copy }) => {
      await withFallbackFixture(size, async ({ history }) => {
        const ownership = new RowOwnership();
        const retained: IContent[] = [];
        try {
          await history.withRawHistorySnapshot(async (snapshot) => {
            for (const row of snapshot) {
              const held = copy ? { ...row } : row;
              retained.push(held);
              ownership.retain(held);
            }
          });
          expect(ownership.snapshot().liveRows).toBe(size);
          expect(ownership.snapshot().liveSerializedBytes).toBeGreaterThan(
            size * 2048,
          );
          expect(
            ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(process.env.FALLBACK_RETAINING_TRAP === '1');
        } finally {
          for (const row of retained) ownership.release(row);
          retained.length = 0;
        }
        expect(ownership.snapshot().liveRows).toBe(0);
      });
    },
    180000,
  );
});
