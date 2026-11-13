/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { ScratchRootOwner } from './scratch-root.js';
import { MediaMetricByteIndex } from './media-metric-byte-index.js';

describe('media metric scratch ownership', () => {
  it('deduplicates reference bytes inside the supplied root and releases its index', () => {
    const scratchRoots = new ScratchRootOwner();
    const index = new MediaMetricByteIndex(scratchRoots);
    try {
      expect(index.add('first', 32)).toBe(32);
      expect(index.add('first', 32)).toBe(0);
      expect(index.add('second', 64)).toBe(64);
      expect(readdirSync(scratchRoots.getRoot())).toHaveLength(1);
      index.close();
      expect(readdirSync(scratchRoots.getRoot())).toStrictEqual([]);
    } finally {
      index.close();
      scratchRoots.removeRoot();
    }
  });
});
