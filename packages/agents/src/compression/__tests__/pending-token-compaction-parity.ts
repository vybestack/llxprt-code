/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import {
  withRollbackFixture,
  durableRowsOf,
} from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { requireJournalRecorder } from '@vybestack/llxprt-code-core/services/history/recorderBackend.js';
import type { JournalStore } from '@vybestack/llxprt-code-core/journal/journalStore.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { truncateLargestToolResponses } from '../toolResultTruncator.js';
import { withNativeValueFixture } from './support/native-value-fixture.js';
import type { OperationFileCreates } from './support/operation-file-creates.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import {
  freezeRows,
  lengthTokenizer,
  pendingArrayOracle,
  pendingRankRow,
  pendingTokenDeps,
  PENDING_BUDGET,
} from './pending-token-native-helpers.js';

export interface PendingCompactionCase {
  readonly history: HistoryService;
  readonly recording: JournalStore;
  readonly operation: () => Promise<void>;
}

export async function pendingCompactionParity(
  select: (fixture: PendingCompactionCase) => Promise<OperationFileCreates>,
): Promise<void> {
  const size = 8192;
  await withNativeValueFixture(
    async ({ history, durable, owners, recording }) => {
      await withRollbackFixture(async (old, recorder) => {
        lengthTokenizer(history);
        lengthTokenizer(old);
        const input = Array.from({ length: size }, (_, index) =>
          pendingRankRow(index, size),
        );
        freezeRows(input);
        const original = JSON.stringify(input);
        await history.detachedValues.replace(input);
        await old.detachedValues.replace(input);
        await history.waitForCommit();
        await recorder.flush();
        const session = await requireJournalRecorder(recording).session();
        const limit = history.getTotalTokens() + PENDING_BUDGET - 4200.5;
        const expected = await pendingArrayOracle(input, old, limit);
        let oldResets = 0;
        const oldResult = await truncateLargestToolResponses(
          pendingTokenDeps(old, () => {
            oldResets++;
          }),
          limit,
        );
        let resets = 0;
        const files = await select({
          history,
          recording: session.store,
          operation: async () => {
            const result = await truncateLargestToolResponses(
              pendingTokenDeps(history, () => {
                resets++;
              }),
              limit,
            );
            expect(result).toStrictEqual(oldResult);
            expect(result).toStrictEqual({
              replacedCount: expected.replacedCount,
              projected: expected.projected,
              success: expected.success,
            });
          },
        });
        expect(expected.replacedCount).toBe(2);
        expect(await Array.fromAsync(history.streamRawHistory())).toStrictEqual(
          [...expected.rows],
        );
        expect(await Array.fromAsync(old.streamRawHistory())).toStrictEqual([
          ...expected.rows,
        ]);
        expect(resets).toBe(2);
        expect(oldResets).toBe(2);
        expect(history.getTotalTokens()).toBe(old.getTotalTokens());
        expect(history.getContextRange()).toStrictEqual(old.getContextRange());
        expect(await durable()).toStrictEqual(
          await compressionValueDigest(expected.rows),
        );
        await recorder.flush();
        expect(await durableRowsOf(recorder)).toStrictEqual([...expected.rows]);
        expect(JSON.stringify(input)).toBe(original);
        expect(
          owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
        expect(owners.snapshot().liveRows).toBe(0);
        process.stdout.write(
          `PENDING_COMPACTION_PARITY ${JSON.stringify({ size, replaced: expected.replacedCount, projected: expected.projected, primary: history.journalPath(), recording: session.path, files })}\n`,
        );
      });
    },
  );
}
