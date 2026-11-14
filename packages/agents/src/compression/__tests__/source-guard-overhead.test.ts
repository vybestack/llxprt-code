import { createTestScratchOwner } from '@vybestack/llxprt-code-core/storage/__tests__/support/scratch-owner.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { SourceCandidate } from '../source-candidate.js';
import { createSourceCompressionCallback } from '../source-compression-callback.js';
import { ContextOverflowError } from '../contextOverflowError.js';
const historyScratchRoots = createTestScratchOwner();

async function callbackAtLimit(contextLimit: number): Promise<unknown> {
  const history = new HistoryService({ scratchRoots: historyScratchRoots });
  const source = await history.prepareCuratedForProviderSnapshot([
    { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
  ]);
  const candidate = new SourceCandidate(
    source,
    async () => 1,
    async () => source,
    { read: async () => [], replace: () => undefined },
    () => () => true,
  );
  const limits = {
    completionBudget: 0,
    limit: 10000,
    marginAdjustedLimit: 9000,
    compressionThreshold: 8000,
  };
  const callback = createSourceCompressionCallback({
    candidate,
    defaultLimits: limits,
    pendingRecoverable: true,
    getHistoryTokens: () => 0,
    stageActions: () => ({
      optimizeDensity: async () => undefined,
      compress: async () => PerformCompressionResult.NOOP,
      replaceSource: () => candidate.replace(),
      fallback: async () => ({ truncationApplied: false }),
      truncateToolResponses: async () => ({ replacedCount: 0 }),
      warn: () => undefined,
    }),
    warn: () => undefined,
  });
  try {
    return await callback({ estimatedTokens: 5001, contextLimit });
  } catch (error) {
    return error;
  } finally {
    await source.close();
  }
}

describe('journal source guard overhead', () => {
  it('rejects when fixed overhead consumes the entire context', async () => {
    expect(await callbackAtLimit(5000)).toBeInstanceOf(ContextOverflowError);
  });
  it('accepts a request fitting exactly in the remaining context', async () => {
    const result = await callbackAtLimit(5001);
    expect(result).not.toBeInstanceOf(Error);
    expect(result).toMatchObject({ count: 1 });
  });
});
