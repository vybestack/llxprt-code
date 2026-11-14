/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectJournalRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import {
  durableRowsOf,
  withRollbackFixture,
} from '../../chronology-rollback-test-helpers.js';
import type { HistoryService } from '../../HistoryService.js';
import type { IContent } from '../../IContent.js';
import { withNativePurgeFixture } from './native-purge-fixture.js';
type HistoryBackend = 'old' | 'journal';

type Action = (
  history: HistoryService,
  persistedRows: () => Promise<IContent[]>,
) => Promise<void>;

export async function withPurgeFailureFixture(
  backend: HistoryBackend,
  action: Action,
): Promise<void> {
  if (backend === 'old') {
    await withRollbackFixture(async (history, recorder) => {
      await action(history, () => durableRowsOf(recorder));
    });
    return;
  }
  await withNativePurgeFixture(async ({ history, assertDurable }) => {
    await action(history, async () => {
      const saved: IContent[] = [];
      await collectJournalRowsForAssertions(history, (rows) => {
        saved.push(...rows);
      });
      await assertDurable(saved);
      return saved;
    });
  });
}
