/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { HistoryJournalStore } from '@vybestack/llxprt-code-core/services/history/historyJournalStore.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { sourceRootSetup } from './support/prompt-envelope-source-test-helpers.js';
import {
  createWorkload,
  type Workload,
} from './support/journal-retained-growth-workload.js';

const root = sourceRootSetup();
const UNDER_LIMIT = 4_000_000;

/**
 * Journal snapshots captured per send, through the real ChatSession on a
 * journal-backed history. The counts must not depend on how many rows the
 * session holds: every capture is an O(appended bytes) fold against the
 * store's checkpoint, and the send opens one curated snapshot plus one more
 * for each durable mutation the enforcement ladder performs.
 */
async function countSend(
  workload: Workload,
  turn: number,
): Promise<{ opens: number; captures: number }> {
  const opens = spyOn(
    HistoryService.prototype,
    'prepareCuratedForProviderSnapshot',
  );
  const captures = spyOn(HistoryJournalStore.prototype, 'capturePendingFold');
  try {
    await workload.runTurn(turn);
    return {
      opens: opens.mock.calls.length,
      captures: captures.mock.calls.length,
    };
  } finally {
    opens.mockRestore();
    captures.mockRestore();
  }
}

async function grow(workload: Workload, rows: number): Promise<void> {
  for (let index = 0; index < rows; index++) {
    workload.history.add({
      speaker: index % 2 === 0 ? 'human' : 'ai',
      blocks: [{ type: 'text', text: `row ${index} ${'filler '.repeat(60)}` }],
    });
  }
  await workload.history.waitForTokenUpdates();
  await workload.history.waitForCommit();
}

describe('journal snapshots per send', () => {
  let workload: Workload | undefined;
  afterEach(async () => {
    await workload?.dispose();
    workload = undefined;
  });

  async function measure(
    rows: number,
    ladder: boolean,
  ): Promise<{ opens: number; captures: number }> {
    workload = await createWorkload(root(), 'normal', UNDER_LIMIT);
    await grow(workload, rows);
    // Warm sends settle the fold checkpoint the way a long session has it.
    await workload.runTurn(1);
    await workload.runTurn(2);
    if (ladder)
      workload.setContextLimit(
        Math.floor(workload.history.getTotalTokens() * 0.6),
      );
    const counts = await countSend(workload, 3);
    await workload.dispose();
    workload = undefined;
    return counts;
  }

  it('opens one curated snapshot and three journal captures per send under the limit, at any history size', async () => {
    const small = await measure(40, false);
    const large = await measure(400, false);
    expect(small).toStrictEqual({ opens: 1, captures: 3 });
    expect(large).toStrictEqual(small);
  }, 120_000);

  it('rebuilds the snapshot once per ladder mutation, with a fixed number of captures per rebuild', async () => {
    for (const rows of [40, 400]) {
      const counts = await measure(rows, true);
      // Initial snapshot, one rebuild after density optimization and one after
      // each compression attempt (a retry follows an ineffective first one).
      expect(counts.opens).toBeGreaterThanOrEqual(3);
      expect(counts.opens).toBeLessThanOrEqual(4);
      // A send captures the journal 3 times; each rebuild adds 4, whatever the history size.
      expect(counts.captures).toBe(3 + 4 * (counts.opens - 1));
    }
  }, 120_000);
});
