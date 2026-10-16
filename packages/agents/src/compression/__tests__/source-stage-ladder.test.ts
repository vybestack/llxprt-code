/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { ProviderSourceEnforcer } from '../provider-source-enforcement.js';
import { runSourceStages } from '../source-stage-ladder.js';
import type { FallbackTransactionOutcome } from '../providerFallbackTransaction.js';
import { ContextOverflowError } from '../contextOverflowError.js';

const limits = {
  completionBudget: 100,
  limit: 4000,
  marginAdjustedLimit: 3000,
  compressionThreshold: 2000,
};

/** Each estimate consumes the next request-token measurement; stages record their order. */
function ladder(
  measurements: number[],
  compressResults: PerformCompressionResult[],
  compressFailure?: Error,
  hardLimit: {
    fallback?: FallbackTransactionOutcome;
    toolFailure?: Error;
    replacedCount?: number;
  } = {},
) {
  const stages: string[] = [];
  const queue = [...measurements];
  const results = [...compressResults];
  const enforcer = new ProviderSourceEnforcer({
    limits,
    estimate: async () => {
      stages.push('estimate');
      const next = queue.shift();
      if (next === undefined) throw new Error('unexpected extra estimate');
      return next;
    },
    getHistoryTokens: () => 6000,
  });
  const actions = {
    optimizeDensity: async () => void stages.push('density'),
    compress: async () => {
      stages.push('compress');
      if (compressFailure !== undefined) throw compressFailure;
      return results.shift() ?? PerformCompressionResult.NOOP;
    },
    replaceSource: async () => void stages.push('replace'),
    fallback: async (target: number | undefined) => {
      stages.push(`fallback:${target}`);
      return hardLimit.fallback ?? { truncationApplied: true };
    },
    truncateToolResponses: async () => {
      stages.push('tools');
      if (hardLimit.toolFailure !== undefined) throw hardLimit.toolFailure;
      return { replacedCount: hardLimit.replacedCount ?? 1 };
    },
    warn: () => stages.push('warn'),
  };
  return { stages, enforcer, actions };
}

describe('source stage ladder order and thresholds', () => {
  it('sends without any stage at or below the compression threshold', async () => {
    const { stages, enforcer, actions } = ladder([1900], []);
    await runSourceStages(enforcer, actions, true);
    expect(stages).toStrictEqual(['estimate']);
  });

  it('stops after density optimization when it reaches the threshold', async () => {
    const { stages, enforcer, actions } = ladder([2500, 1800], []);
    await runSourceStages(enforcer, actions, true);
    expect(stages).toStrictEqual([
      'estimate',
      'density',
      'replace',
      'estimate',
    ]);
  });

  it('compresses once and re-estimates the replacement when it fits the safety limit', async () => {
    const { stages, enforcer, actions } = ladder(
      [2500, 2500, 1000],
      [PerformCompressionResult.COMPRESSED],
    );
    await runSourceStages(enforcer, actions, true);
    expect(stages).toStrictEqual([
      'estimate',
      'density',
      'replace',
      'estimate',
      'compress',
      'replace',
      'estimate',
    ]);
  });

  it('retries an ineffective completed compression exactly once', async () => {
    const { stages, enforcer, actions } = ladder(
      [3400, 3400, 3380, 1000],
      [
        PerformCompressionResult.COMPRESSED,
        PerformCompressionResult.COMPRESSED,
      ],
    );
    await runSourceStages(enforcer, actions, true);
    expect(stages.filter((stage) => stage === 'compress')).toHaveLength(2);
    expect(stages[stages.length - 1]).toBe('estimate');
  });

  it('runs deficit-exact fallback truncation after a failed compression and sends when it fits', async () => {
    const failure = new Error('compressor exploded');
    const { stages, enforcer, actions } = ladder(
      [3400, 3400, 3400, 1000],
      [],
      failure,
    );
    await runSourceStages(enforcer, actions, true);
    expect(
      stages.map((stage) => stage.replace(/^fallback:.*/, 'fallback')),
    ).toStrictEqual([
      'estimate',
      'density',
      'replace',
      'estimate',
      'compress',
      'warn',
      'replace',
      'estimate',
      'fallback',
      'replace',
      'estimate',
    ]);
  });

  it('truncates tool responses only after fallback leaves the request over the limit', async () => {
    const { stages, enforcer, actions } = ladder(
      [3400, 3400, 3400, 3400, 1000],
      [PerformCompressionResult.NOOP],
    );
    await runSourceStages(enforcer, actions, true);
    expect(
      stages.map((stage) => stage.replace(/^fallback:.*/, 'fallback')),
    ).toStrictEqual([
      'estimate',
      'density',
      'replace',
      'estimate',
      'compress',
      'replace',
      'estimate',
      'fallback',
      'replace',
      'estimate',
      'tools',
      'replace',
      'estimate',
    ]);
  });

  it('returns structured overflow only after fallback and tool truncation are exhausted', async () => {
    const toolFailure = new Error('ranking failed');
    const { stages, enforcer, actions } = ladder(
      [3400, 3400, 3400, 3400, 3400],
      [PerformCompressionResult.NOOP],
      undefined,
      {
        fallback: {
          truncationApplied: false,
          truncationFailure: new Error('fallback rejected'),
        },
        toolFailure,
      },
    );
    const error = await runSourceStages(enforcer, actions, true).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ContextOverflowError);
    expect((error as Error).message).toContain('fallback rejected');
    expect((error as Error).message).toContain('ranking failed');
    expect(stages).toContain('tools');
  });

  it('rejects an unrecoverable pending boundary only above the safety limit', async () => {
    const fits = ladder([2800], []);
    await runSourceStages(fits.enforcer, fits.actions, false);
    expect(fits.stages).toStrictEqual(['estimate']);
    const over = ladder([3400], []);
    await expect(
      runSourceStages(over.enforcer, over.actions, false),
    ).rejects.toThrow('pending-content boundary is unrecoverable');
    expect(over.stages).toStrictEqual(['estimate']);
  });
});
