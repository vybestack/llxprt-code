/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { useLargeRowProof } from './__tests__/support/service-large-row-proof.js';
import { MIB } from './__tests__/support/service-large-row.js';
import { join } from 'node:path';
import { BoundedIdNodeCache } from '../../journal/idTrieCache.js';
import { testJournalOptions } from '../../journal/__tests__/support/namedWriterOwner.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { retainedAfterSettling } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { JournalSession } from './journalSession.js';

/** 256-byte lifecycle overhead plus two maximum encoded 98,304-byte rows. */
const RECORDER_ALLOWANCE = 761_776 + 2 * 114_862;
describe('closed recorder journal metadata lifetime', () => {
  const directory = useTempDir('recorder-closed-cache-');
  for (const rows of [12, 48]) {
    it(`releases populated index caches after closing a ${rows}-row recorder`, async () => {
      const caches: Array<WeakRef<object>> = [];
      const session = await JournalSession.create(
        join(directory(), `${rows}.llxj`),
        {
          ...testJournalOptions(),
          createCache: () => {
            const cache = new BoundedIdNodeCache();
            caches.push(new WeakRef(cache));
            return cache;
          },
        },
      );
      for (let index = 0; index < rows; index++) {
        await session.append([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: `row ${index}` }],
          },
        ]);
      }
      const populated = caches.slice();
      expect(populated).toHaveLength(3);
      await session.close();
      expect(await retainedAfterSettling(populated)).toBe(0);
      expect(session.store.published?.rows).toBe(rows);
    });
  }
});

for (const rows of [48]) {
  describe(`HistoryService ${rows}-row recorder continuation`, () => {
    const measure = useLargeRowProof(98_304 / MIB, rows);
    it('releases decoded history after resume and continuation', async () => {
      const result = await measure();
      expect(result.bytes).toBe(rows * 98_304);
      expect(result.growth).toHaveLength(3);
      expect(
        Math.min(result.admissionGrowth, ...result.growth),
      ).toBeGreaterThan(-256 * 1024);
      expect(Math.max(result.admissionGrowth, ...result.growth)).toBeLessThan(
        RECORDER_ALLOWANCE,
      );
    }, 180_000);
  });
}

describe('HistoryService many-row recorder retention control', () => {
  const measure = useLargeRowProof(98_304 / MIB, 48);
  it('rejects retaining the history under the same continuation allowance', async () => {
    const result = await measure(true);
    expect(result.retained).toHaveLength(48);
    expect(Math.min(...result.growth)).toBeGreaterThan(3 * RECORDER_ALLOWANCE);
    expect(Math.min(...result.growth)).toBeGreaterThan(MIB);
  }, 180_000);
});
