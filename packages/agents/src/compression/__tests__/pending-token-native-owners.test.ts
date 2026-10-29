/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  openOwnedJournal,
  type OwnedJournal,
} from '@vybestack/llxprt-code-core/services/history/journalOwnedFixture.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { journalRoutedHistory } from './support/journal-detached-history.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import { nativeRankingProjection } from './support/native-ranking-projection.js';
import { toolRankingRow } from './tool-truncation-stream-helpers.js';
import {
  pendingTokenDeps,
  lengthTokenizer,
} from './pending-token-native-helpers.js';
import { truncateLargestToolResponses } from '../toolResultTruncator.js';

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
  lengthTokenizer(history);
  return history;
}

describe('pending-token native publication source ownership', () => {
  const directory = useTempDir('pending-token-native-owners-');
  it.each([3, 64, 65, 5000])(
    'keeps raw source owners across a hole and two immediate projection rounds at %i rows',
    async (size) => {
      const input = Array.from(
        { length: size },
        (_, index): { content: IContent; origin: string } => ({
          content:
            index === 1
              ? {
                  ...toolRankingRow(index, 64),
                  speaker: 'ai',
                  blocks: [],
                }
              : toolRankingRow(index, 64),
          origin: index % 2 === 0 ? 'owner-a' : 'owner-b',
        }),
      );
      const owned = await openOwnedJournal(
        join(directory(), 'owners.llxj'),
        input,
      );
      const history = await historyOver(owned);
      const pinned = await owned.session.store.snapshot();
      try {
        const limit = (size - 1) * 1000 - 451;
        const files = await operationFileCreates(async () => {
          const result = await truncateLargestToolResponses(
            {
              ...pendingTokenDeps(history),
              estimateBlockTokensAsync: async (block) =>
                block.type === 'tool_response' &&
                block.providerMetadata?.contextTruncated !== true
                  ? 1000
                  : 100,
              computeProjected: () =>
                nativeRankingProjection(owned.store.streamRows(), 550),
            },
            limit,
          );
          expect(result).toStrictEqual({
            replacedCount: 2,
            projected: (size - 1) * 1000 - 900,
            success: true,
          });
        }, true);
        expect(await owned.originsOfRows()).toStrictEqual(
          input.filter((_, index) => index !== 1).map(({ origin }) => origin),
        );
        expect(pinned.rows).toBe(size);
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
