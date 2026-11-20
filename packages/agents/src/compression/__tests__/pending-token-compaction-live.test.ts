/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { observePendingCompaction } from './pending-token-compaction-observer.js';
import { pendingCompactionParity } from './pending-token-compaction-parity.js';
import { openNativeToolRanking } from '../native-tool-ranking.js';
import { pendingTokenDeps } from './pending-token-native-helpers.js';

describe('pending-token parity with persistent compaction', () => {
  const size = 65;
  it('matches all 65 array and disk values across the exact persistent compactor swap without observer pins', async () => {
    await pendingCompactionParity(
      size,
      async ({
        history,
        recording,
        operation,
        armCompaction,
        stopCompaction,
        compactionDue,
      }) => {
        armCompaction();
        const files = await observePendingCompaction(
          recording,
          operation,
          compactionDue,
          stopCompaction,
        );
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
          expect(header.count).toBe(size - 2);
          expect((await tree.at(header.root, 0)).ordinal).toBe(size - 3);
          expect((await tree.at(header.root, 0)).score).toBeGreaterThan(4096);
        } finally {
          await ranking.close();
        }
        return files;
      },
    );
  }, 180_000);
});
