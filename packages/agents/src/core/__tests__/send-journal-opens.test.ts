/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { measureJournalReadCost } from './support/journal-read-cost.js';
import {
  createWorkload,
  type Workload,
} from './support/journal-retained-growth-workload.js';
import { sourceRootSetup } from './support/prompt-envelope-source-test-helpers.js';

const root = sourceRootSetup();
const UNDER_LIMIT = 4_000_000;

async function countSend(workload: Workload, turn: number): Promise<number> {
  const opens = spyOn(
    HistoryService.prototype,
    'prepareCuratedForProviderSnapshot',
  );
  try {
    const before = workload.history.length();
    const tokens = await measureJournalReadCost(async () =>
      workload.history.getTotalTokens(),
    );
    expect(tokens.value).toBeGreaterThan(0);
    expect(tokens.cost).toStrictEqual({ walks: 0, entries: 0, rows: 0 });
    const last = await measureJournalReadCost(
      async () => (await workload.history.getLastContent())?.speaker,
    );
    expect(last.value).toBe('ai');
    expect(last.cost).toStrictEqual({ walks: 0, entries: 0, rows: 1 });
    const { cost } = await measureJournalReadCost(() => workload.runTurn(turn));
    const snapshots = opens.mock.calls.length;
    if (snapshots === 1) {
      expect(cost).toStrictEqual({ walks: 0, entries: 0, rows: 1 });
      expect(workload.history.length()).toBe(before + 4);
    }
    return snapshots;
  } finally {
    opens.mockRestore();
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

  async function measure(rows: number, ladder: boolean): Promise<number> {
    workload = await createWorkload(root(), 'normal', UNDER_LIMIT);
    await grow(workload, rows);
    await workload.runTurn(1);
    await workload.runTurn(2);
    if (ladder) {
      workload.setContextLimit(
        Math.floor(workload.history.getTotalTokens() * 0.6),
      );
      workload.history.add({
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: [
              '--- snapshot.ts ---',
              'old file contents',
              '--- End of content ---',
              '--- snapshot.ts ---',
              'new file contents',
              '--- End of content ---',
            ].join('\n'),
          },
        ],
      });
      workload.history.add({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'ready' }],
      });
      await workload.history.waitForCommit();
    }
    const counts = await countSend(workload, 3);
    await workload.dispose();
    workload = undefined;
    return counts;
  }

  it('opens one curated snapshot per send under the limit, at any history size', async () => {
    const small = await measure(40, false);
    const large = await measure(400, false);
    const expected = 1;
    expect(small).toStrictEqual(expected);
    expect(large).toStrictEqual(small);
  }, 120_000);

  it('rebuilds the snapshot once per ladder mutation', async () => {
    for (const rows of [40, 400]) {
      const counts = await measure(rows, true);
      // Initial snapshot, one rebuild after density optimization and one after
      // each compression attempt (a retry follows an ineffective first one).
      expect(counts).toBeGreaterThanOrEqual(3);
      expect(counts).toBeLessThanOrEqual(4);
    }
  }, 120_000);
});
