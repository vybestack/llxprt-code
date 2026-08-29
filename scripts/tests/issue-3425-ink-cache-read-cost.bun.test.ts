/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reading a bounded Ink cache must not allocate.
 *
 * The caches added for issue #3386 refreshed LRU recency by deleting the entry
 * and re-inserting it on every hit. That churns the JSC Map backing store on a
 * path the renderer walks per character. In a captured burst profile it was the
 * single hottest site at 27.5% of samples, and it turned cache hits into an
 * allocation source large enough to outrun the collector.
 *
 * See issue #3425.
 */

import { gcAndSweep, heapSize } from 'bun:jsc';
import { describe, expect, it } from 'bun:test';
import { DataLimitedLruMap } from '../../node_modules/ink/build/data-limited-lru-map.js';

const ENTRY_COUNT = 10_000;
const READ_COUNT = 2_000_000;

/**
 * A read-only workload allocates nothing of its own, so any growth measured
 * here belongs to the cache. The delete-and-reinsert implementation allocated
 * about 7 bytes per hit; a non-mutating read allocates none.
 */
const MAX_READ_HEAP_GROWTH_BYTES = 2 * 1024 * 1024;

function settledHeapSize(): number {
  gcAndSweep();
  gcAndSweep();
  return heapSize();
}

describe('issue #3425 bounded cache read cost', () => {
  it('does not grow the heap when serving cache hits', () => {
    const cache = new DataLimitedLruMap<number>(
      ENTRY_COUNT,
      Number.MAX_SAFE_INTEGER,
    );
    const keys = Array.from({ length: ENTRY_COUNT }, (_, i) => `key-${i}`);
    for (const [index, key] of keys.entries()) {
      cache.set(key, index);
    }

    const before = settledHeapSize();
    let observed = 0;
    for (let i = 0; i < READ_COUNT; i += 1) {
      observed += cache.get(keys[i % ENTRY_COUNT]!) ?? -1;
    }
    const growth = heapSize() - before;

    expect(observed).toBeGreaterThan(0);
    expect(growth).toBeLessThan(MAX_READ_HEAP_GROWTH_BYTES);
  });

  it('still evicts the least recently used entry, so reads must affect eviction order', () => {
    const cache = new DataLimitedLruMap<string>(3, Number.MAX_SAFE_INTEGER);
    cache.set('a', 'first');
    cache.set('b', 'second');
    cache.set('c', 'third');

    // Touching 'a' must make 'b' the least recently used.
    expect(cache.get('a')).toBe('first');
    cache.set('d', 'fourth');

    expect([...cache.keys()].sort()).toEqual(['a', 'c', 'd']);
    expect(cache.get('b')).toBeUndefined();
  });

  it('orders surviving entries least recently used first after a read', () => {
    const cache = new DataLimitedLruMap<string>(3, Number.MAX_SAFE_INTEGER);
    cache.set('x', 'ex');
    cache.set('y', 'why');
    cache.set('z', 'zed');

    expect(cache.get('x')).toBe('ex');

    // 'y' is now the oldest, then 'z', with the freshly read 'x' last.
    expect([...cache.keys()]).toEqual(['y', 'z', 'x']);
  });
});
