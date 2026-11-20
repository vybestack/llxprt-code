/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  openOwnedJournal,
  type OwnedJournal,
} from '@vybestack/llxprt-code-core/services/history/journalOwnedFixture.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { journalRoutedHistory } from './support/journal-detached-history.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import { truncateToolResponsesInOnePass } from '../toolResponseOnePass.js';
import { toolRankingRow } from './tool-truncation-stream-helpers.js';
import { nativeRankingProjection } from './support/native-ranking-projection.js';

async function historyOver(
  owned: OwnedJournal,
): Promise<ReturnType<typeof journalRoutedHistory>> {
  const history = journalRoutedHistory(owned);
  await history.waitForCommit();
  history.openToolResponseRanking = (policy, overlay) =>
    owned.store.openToolResponseRanking(policy, overlay);
  history.historyMutationGuard = () => {
    const mark = owned.store.mutationMark();
    return () => owned.store.isCurrentMutationMark(mark);
  };
  history.waitForTokenUpdates = () => owned.host.waitForTokenUpdates();
  return history;
}

describe('native global ranking source owners', () => {
  const directory = useTempDir('native-ranking-owners-');
  it.each([3, 64, 65, 5000])(
    'keeps source ownership across an empty-AI hole and repeated projection rounds at %i rows',
    async (size) => {
      const owned = await openOwnedJournal(
        join(directory(), 'owners.llxj'),
        Array.from({ length: size }, (_, index) => ({
          content:
            index === 1
              ? { ...toolRankingRow(index, 64), speaker: 'ai', blocks: [] }
              : toolRankingRow(index, 64),
          origin: index % 2 === 0 ? 'owner-a' : 'owner-b',
        })),
      );
      const history = await historyOver(owned);
      const pinned = await owned.session.store.snapshot();
      try {
        const limit = Math.floor((size - 1) * 1000 * 0.78);
        const expectedCount = Math.ceil(((size - 1) * 1000 - limit) / 450);
        const files = await operationFileCreates(async () => {
          const result = await truncateToolResponsesInOnePass(
            {
              historyService: history,
              rankingRevision: 'native-ranking-owners:1',
              logger: new DebugLogger('test:native-ranking-owners'),
              pendingContents: [],
              estimateBlockTokensAsync: async (block) =>
                block.type === 'tool_response' &&
                block.providerMetadata?.contextTruncated !== true
                  ? 1000
                  : 100,
              computeProjected: () =>
                nativeRankingProjection(owned.store.streamRows(), 550),
              getRuntimeModel: () => 'native-ranking-owners',
            },
            limit,
          );
          expect(result.replacedCount).toBe(expectedCount);
          expect(result.projected).toBe(
            (size - 1) * 1000 - expectedCount * 450,
          );
          expect(result.success).toBe(true);
        }, true);
        const expectedOwners = Array.from({ length: size }, (_, index) => index)
          .filter((index) => index !== 1)
          .map((index) => (index % 2 === 0 ? 'owner-a' : 'owner-b'));
        expect(await owned.originsOfRows()).toStrictEqual(expectedOwners);
        expect(files).toStrictEqual({ directories: [], files: [] });
      } finally {
        await pinned.close();
        await history.dispose();
        await owned.dispose();
      }
    },
    180_000,
  );
});
