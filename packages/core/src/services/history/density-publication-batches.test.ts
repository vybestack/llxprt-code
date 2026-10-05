/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { HistoryDensityRows } from './historyDensityRows.js';
import { planMutation } from './planHistoryMutation.js';
import { opToEnvelope } from './historyJournalEnvelope.js';
import {
  withRollbackFixture,
  rowsOf,
} from './chronology-rollback-test-helpers.js';
import { suffixRow } from './history-suffix-test-helpers.js';
import type { IContent } from './IContent.js';
import type { DensityRowDecision } from './historyDiskDensity.js';
import type { HistoryJournalOp } from './historyJournalStore.js';
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';

async function consumePlan(
  plan: Generator<HistoryJournalOp, void, unknown>,
  recorder: SessionRecordingService,
  owner: RowOwnership,
  abandon: boolean,
): Promise<void> {
  try {
    for (const op of plan) {
      if (op.kind === 'density' && op.payload.replacements.length > 0)
        expect(owner.snapshot().liveRows).toBeGreaterThanOrEqual(
          op.payload.replacements.length,
        );
      if (abandon) break;
      const { type, payload } = opToEnvelope(op);
      await recorder.commit(type, payload);
    }
  } finally {
    plan.return();
  }
  expect(owner.snapshot().liveRows).toBe(0);
  expect(owner.snapshot().peakRows).toBeLessThanOrEqual(440);
}

async function publish(
  originals: readonly IContent[],
  decisions: ReadonlyArray<DensityRowDecision | undefined>,
  abandon = false,
): Promise<IContent[]> {
  return withRollbackFixture(async (history, recorder) => {
    const previous = new HistoryDensityRows();
    const next = new HistoryDensityRows();
    const owner = new RowOwnership();
    try {
      for (const [index, row] of originals.entries()) {
        previous.append(row);
        await recorder.commit('content', { content: row });
        const decision = decisions[index];
        if (decision?.kind !== 'removed')
          next.append(decision?.kind === 'replaced' ? decision.row : row);
      }
      const diskDensityResult = {
        removalCount: decisions.filter((entry) => entry?.kind === 'removed')
          .length,
        replacementCount: decisions.filter(
          (entry) => entry?.kind === 'replaced',
        ).length,
        metadata: {
          readWritePairsPruned: 0,
          fileDeduplicationsPruned: 0,
          recencyPruned: 0,
        },
        decision: (index: number): DensityRowDecision | undefined =>
          decisions[index],
        close: (): void => {},
      };
      const plan = planMutation(
        previous,
        { nextHistory: next, diskDensityResult, options: {} },
        owner,
      );
      await consumePlan(plan, recorder, owner, abandon);
      return await rowsOf(history);
    } finally {
      previous.close();
      next.close();
    }
  });
}

function marked(index: number, seq: number): IContent {
  const row = suffixRow(index);
  return {
    ...row,
    metadata: { chronology: { seq, userTurn: 1, step: 0, recordedAt: 0 } },
  };
}

describe('bounded density publication preserves sequential addressed semantics', () => {
  it('charges all live replacement rows until durable publication consumes them', async () => {
    const originals = Array.from({ length: 128 }, (_, index) =>
      suffixRow(index, 2048),
    );
    const replacements = originals.map((row, index) => ({
      ...row,
      blocks: [{ type: 'text' as const, text: `changed:${index}` }],
    }));
    expect(
      await publish(
        originals,
        replacements.map((row) => ({ kind: 'replaced', row })),
      ),
    ).toStrictEqual(replacements);
  });
  it('does not resurrect duplicate chronology removed before a later replacement', async () => {
    expect(
      await publish(
        [marked(0, 7), marked(1, 7)],
        [{ kind: 'removed' }, { kind: 'replaced', row: marked(2, 7) }],
      ),
    ).toStrictEqual([]);
  });
  it('releases the paused batch and lookahead when publication is abandoned', async () => {
    const originals = Array.from({ length: 128 }, (_, index) =>
      suffixRow(index, 2048),
    );
    const decisions: DensityRowDecision[] = originals.map((row, index) => ({
      kind: 'replaced',
      row: { ...row, blocks: [{ type: 'text', text: `abandoned:${index}` }] },
    }));
    expect(await publish(originals, decisions, true)).toStrictEqual(originals);
  });
  it('removes an earlier replacement when duplicate chronology is removed later', async () => {
    expect(
      await publish(
        [marked(0, 7), marked(1, 7)],
        [{ kind: 'replaced', row: marked(2, 7) }, { kind: 'removed' }],
      ),
    ).toStrictEqual([]);
  });
  it('applies chronology-changing replacements before later addressed removals', async () => {
    expect(
      await publish(
        [marked(0, 7), marked(1, 9)],
        [{ kind: 'replaced', row: marked(2, 9) }, { kind: 'removed' }],
      ),
    ).toStrictEqual([]);
  });
});
