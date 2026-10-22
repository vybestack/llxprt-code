/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { observePendingCompaction } from './pending-token-compaction-observer.js';
import { pendingCompactionParity } from './pending-token-compaction-parity.js';
import { openNativeToolRanking } from '../native-tool-ranking.js';
import { pendingTokenDeps } from './pending-token-native-helpers.js';

describe('pending-token parity with persistent compaction', () => {
  it('matches all 8192 array and disk values across the exact persistent compactor swap without observer pins', async () => {
    await pendingCompactionParity(async ({ history, recording, operation }) => {
      const files = await observePendingCompaction(recording, operation);
      const ranking = await openNativeToolRanking({
        ...pendingTokenDeps(history),
        rankingRevision: history.toolRankingRevision('pending-token-native'),
        pendingContents: [],
      });
      if (ranking === undefined)
        throw new Error('Missing post-compaction ranking');
      try {
        const tree = await ranking.toolRanking(
          history.toolRankingRevision('pending-token-native'),
        );
        const header = await tree.header();
        expect(header.count).toBe(8190);
        expect((await tree.at(header.root, 0)).ordinal).toBe(8189);
        expect((await tree.at(header.root, 0)).score).toBeGreaterThan(4096);
      } finally {
        await ranking.close();
      }
      return files;
    });
  }, 180_000);
});
