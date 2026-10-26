/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect, spyOn } from 'bun:test';
import {
  withRollbackFixture,
  durableRowsOf,
} from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { requireJournalRecorder } from '@vybestack/llxprt-code-core/services/history/recorderBackend.js';
import { JournalStore } from '@vybestack/llxprt-code-core/journal/journalStore.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { Version } from '@vybestack/llxprt-code-core/journal/version.js';
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
  armCompaction(): void;
  stopCompaction(): void;
  compactionDue(version: Version): boolean;
}

function compactionTrigger(): {
  arm(store: JournalStore): void;
  stop(): void;
  compactionDue(version: Version): boolean;
  restore(): void;
} {
  let enabled = false;
  let afterCommit = Infinity;
  const compactionDue = (version: Version): boolean =>
    enabled && version.commitSeq > afterCommit;
  const create = JournalStore.create;
  const seam = spyOn(JournalStore, 'create').mockImplementation(
    (path, dependencies) => create(path, { ...dependencies, compactionDue }),
  );
  return {
    arm: (store) => {
      const published = store.published;
      if (published === undefined)
        throw new Error('Missing compaction baseline');
      afterCommit = published.commitSeq;
      enabled = true;
    },
    stop: () => {
      enabled = false;
    },
    compactionDue,
    restore: () => seam.mockRestore(),
  };
}

export async function pendingCompactionParity(
  size: number,
  select: (fixture: PendingCompactionCase) => Promise<OperationFileCreates>,
): Promise<void> {
  const trigger = compactionTrigger();
  try {
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
            armCompaction: () => trigger.arm(session.store),
            stopCompaction: trigger.stop,
            compactionDue: trigger.compactionDue,
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
          await assertHistoryMatches(history, old, expected.rows);
          expect(resets).toBe(2);
          expect(oldResets).toBe(2);
          expect(await durable()).toStrictEqual(
            await compressionValueDigest(expected.rows),
          );
          await recorder.flush();
          expect(await durableRowsOf(recorder)).toStrictEqual([
            ...expected.rows,
          ]);
          expect(JSON.stringify(input)).toBe(original);
          expect(
            owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
          expect(owners.snapshot().liveRows).toBe(0);
          process.stdout.write(
            `PENDING_COMPACTION_PARITY ${JSON.stringify({ size, replaced: expected.replacedCount, projected: expected.projected, historyPath: history.journalPath(), recording: session.path, files })}\n`,
          );
        });
      },
    );
  } finally {
    trigger.restore();
  }
}

async function assertHistoryMatches(
  history: HistoryService,
  old: HistoryService,
  expected: readonly IContent[],
): Promise<void> {
  for (const source of [history, old]) {
    expect(await Array.fromAsync(source.streamRawHistory())).toStrictEqual([
      ...expected,
    ]);
  }
  expect(history.getTotalTokens()).toBe(old.getTotalTokens());
  expect(history.getContextRange()).toStrictEqual(old.getContextRange());
}
