/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ContextOverflowError } from '../contextOverflowError.js';
import { ProviderSourceEnforcer } from '../provider-source-enforcement.js';
import { runSourceStages } from '../source-stage-ladder.js';
import { truncateSourceToolResponses } from '../source-tool-truncation.js';
import {
  COMPLETION_BUDGET,
  candidateOver,
  countJournalWrites,
  journalDigest,
  legacyTruncateSourceToolResponses,
  newStageWork,
  pendingToolRow,
  stageInput,
  totalRequestTokens,
  withMixedHistory,
  type SourceTruncationInput,
  type StageWork,
} from './support/source-tool-truncation-fixture.js';

interface StageRun {
  readonly replacedCount: number;
  readonly digest: string;
  readonly pending: IContent[];
  readonly work: StageWork;
  readonly finalTokens: number;
}

type Stage = (
  input: SourceTruncationInput,
) => Promise<{ readonly replacedCount: number }>;

async function runStage(
  stage: Stage,
  size: number,
  pendingRows: number,
  requestLimit: (total: number) => number,
  toolWeight = 1,
): Promise<StageRun> {
  return withMixedHistory(size, async (history) => {
    const pending = Array.from({ length: pendingRows }, (_, i) =>
      pendingToolRow(i, 1024 + i * 512),
    );
    const total = await totalRequestTokens(history, pending, toolWeight);
    const work = newStageWork();
    countJournalWrites(history, work);
    const candidate = candidateOver(history, pending, work, toolWeight);
    const { replacedCount } = await stage(
      stageInput(history, candidate, requestLimit(total)),
    );
    const finalPending = await candidate.pending.read();
    return {
      replacedCount,
      digest: await journalDigest(history),
      pending: finalPending,
      work,
      finalTokens: await totalRequestTokens(history, finalPending, toolWeight),
    };
  });
}

function weightedTotal(size: number, toolWeight: number): Promise<number> {
  return withMixedHistory(size, (history) =>
    totalRequestTokens(history, [], toolWeight),
  );
}

function rowsTouched(work: StageWork): number {
  return work.projectedRows + work.copiedRows + work.journalRows;
}

describe('last-resort tool-response truncation work per send', () => {
  it('does work linear in rows: four times the rows costs about four times the row reads and writes', async () => {
    const limit = (total: number) => Math.floor(total * 0.8);
    const small = await runStage(truncateSourceToolResponses, 192, 0, limit);
    const large = await runStage(truncateSourceToolResponses, 768, 0, limit);

    expect(small.replacedCount).toBeGreaterThan(0);
    expect(large.replacedCount).toBeGreaterThan(small.replacedCount);
    expect(large.work.journalWrites).toBe(1);
    expect(large.work.projections).toBeLessThanOrEqual(3);
    expect(large.work.copies).toBeLessThanOrEqual(3);
    const ratio = rowsTouched(large.work) / rowsTouched(small.work);
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(5);
  }, 180000);
});

describe('estimate shortfall', () => {
  it('continues from the exact projection when tool responses weigh less than estimated', async () => {
    const limit = (total: number) => Math.floor(total * 0.85);
    const run = await runStage(truncateSourceToolResponses, 192, 0, limit, 0.5);

    expect(run.finalTokens).toBeLessThanOrEqual(
      limit(await weightedTotal(192, 0.5)),
    );
    expect(run.work.journalWrites).toBeGreaterThanOrEqual(2);
    expect(run.work.journalWrites).toBeLessThanOrEqual(4);
    expect(run.work.projections).toBe(run.work.journalWrites + 1);
  }, 180000);
});

describe('over-limit send with no tool responses to shed', () => {
  it('fails with ContextOverflowError at 8192 rows without rewriting the journal', async () => {
    await withMixedHistory(8192, async (history) => {
      const work = newStageWork();
      countJournalWrites(history, work);
      const candidate = candidateOver(history, [], work);
      const total = await totalRequestTokens(history, []);
      // Two thirds of the weight sits in text rows, so no truncation can fit.
      const requestLimit = Math.floor(total * 0.5);
      const before = await journalDigest(history);
      const enforcer = new ProviderSourceEnforcer({
        limits: {
          completionBudget: COMPLETION_BUDGET,
          limit: total * 2,
          marginAdjustedLimit: requestLimit + COMPLETION_BUDGET,
          compressionThreshold: requestLimit,
        },
        estimate: () => candidate.estimate(),
        getHistoryTokens: () => total,
      });
      const started = performance.now();
      const failure = await runSourceStages(
        enforcer,
        {
          optimizeDensity: async () => {},
          compress: async () => PerformCompressionResult.NOOP,
          replaceSource: () => candidate.replace(),
          fallback: async () => ({ truncationApplied: false }),
          truncateToolResponses: () =>
            truncateSourceToolResponses(
              stageInput(history, candidate, requestLimit),
            ),
          warn: () => {},
        },
        true,
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
      const seconds = (performance.now() - started) / 1000;

      expect(failure).toBeInstanceOf(ContextOverflowError);
      expect(seconds).toBeLessThan(60);
      expect(work.journalWrites).toBe(0);
      expect(await journalDigest(history)).toBe(before);
    });
  }, 180000);
});

describe('one-pass truncation equals the per-replacement truncation it replaces', () => {
  const scenarios: ReadonlyArray<{
    readonly name: string;
    readonly size: number;
    readonly pending: number;
    readonly fraction: number;
  }> = [
    { name: 'a single replacement', size: 30, pending: 0, fraction: 0.97 },
    { name: 'history only', size: 30, pending: 0, fraction: 0.8 },
    {
      name: 'history and pending together',
      size: 30,
      pending: 3,
      fraction: 0.8,
    },
    {
      name: 'pending dominates the ranking',
      size: 12,
      pending: 4,
      fraction: 0.7,
    },
    { name: 'every tool response', size: 45, pending: 2, fraction: 0.69 },
  ];

  for (const scenario of scenarios) {
    it(`matches the legacy result for ${scenario.name}`, async () => {
      const { size, pending, fraction } = scenario;
      const limit = (total: number) => Math.floor(total * fraction);
      const legacy = await runStage(
        legacyTruncateSourceToolResponses,
        size,
        pending,
        limit,
      );
      const current = await runStage(
        truncateSourceToolResponses,
        size,
        pending,
        limit,
      );

      expect(legacy.replacedCount).toBeGreaterThan(0);
      expect(current.replacedCount).toBe(legacy.replacedCount);
      expect(current.digest).toBe(legacy.digest);
      expect(current.pending).toStrictEqual(legacy.pending);
      expect(current.finalTokens).toBe(legacy.finalTokens);
    }, 120000);
  }

  it('stops at the same replacement when the limit equals a reachable projection exactly', async () => {
    const reachable = await runStage(
      legacyTruncateSourceToolResponses,
      30,
      2,
      (total) => Math.floor(total * 0.8),
    );
    const limit = () => reachable.finalTokens;
    const legacy = await runStage(
      legacyTruncateSourceToolResponses,
      30,
      2,
      limit,
    );
    const current = await runStage(truncateSourceToolResponses, 30, 2, limit);

    expect(current.replacedCount).toBe(legacy.replacedCount);
    expect(current.digest).toBe(legacy.digest);
    expect(current.pending).toStrictEqual(legacy.pending);
  }, 120000);
});
