import { createTestScratchOwner } from '@vybestack/llxprt-code-core/storage/__tests__/support/scratch-owner.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createUserMessage } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { runGuardedCompression } from '../guardedCompression.js';
import type { GuardedCompressionDeps } from '../guardedCompression.js';
const historyScratchRoots = createTestScratchOwner();

async function texts(history: HistoryService): Promise<string[]> {
  const result: string[] = [];
  for await (const row of history.streamRawHistory())
    for (const block of row.blocks)
      if (block.type === 'text') result.push(block.text);
  return result;
}

function dependencies(
  history: HistoryService,
  performCompression: GuardedCompressionDeps['performCompression'],
) {
  let baseline: number | null = 123;
  return {
    historyService: history,
    logger: new DebugLogger('test:guarded-journal'),
    performCompression,
    getPromptTokenBaseline: () => baseline,
    restorePromptTokenBaseline: (value: number | null) => {
      baseline = value;
    },
  };
}

describe('journal guarded compression', () => {
  it('keeps an accepted trailer when a lock-release observer fails before compressionEnded', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    try {
      await history.addBatch([createUserMessage('original')]);
      history.on('compressionLockReleased', () => {
        throw new Error('release observer failed');
      });
      const deps = dependencies(history, async (_id, options) => {
        history.startCompression();
        const summary = createUserMessage('committed summary');
        await history.detachedValues.replace([summary]);
        options.onCommitted();
        history.endCompression(summary, 1);
        return PerformCompressionResult.COMPRESSED;
      });
      expect(await runGuardedCompression(deps, 'test')).toBeUndefined();
      expect(await texts(history)).toStrictEqual(['committed summary']);
    } finally {
      await history.dispose();
    }
  });

  it('compensates an incomplete rewrite while preserving an independent append and scalar state', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    try {
      await history.addBatch([createUserMessage('original')]);
      history.setCacheAnchorSeq(1);
      const deps = dependencies(history, async () => {
        await history.detachedValues.replace([createUserMessage('partial')]);
        await history.addBatch([createUserMessage('independent')]);
        history.resetCacheAnchorSeq();
        deps.restorePromptTokenBaseline(null);
        throw new Error('compression failed');
      });
      expect((await runGuardedCompression(deps, 'test'))?.message).toBe(
        'compression failed',
      );
      expect(await texts(history)).toStrictEqual(['original', 'independent']);
      expect(history.getCacheAnchorSeq()).toBe(1);
      expect(deps.getPromptTokenBaseline()).toBe(123);
    } finally {
      await history.dispose();
    }
  });

  it('keeps a committed rewrite when a later compression observer throws', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    try {
      await history.addBatch([createUserMessage('original')]);
      history.on('compressionEnded', () => {
        throw new Error('observer failed');
      });
      const deps = dependencies(history, async () => {
        history.startCompression();
        const summary = createUserMessage('committed summary');
        await history.detachedValues.replace([summary]);
        history.endCompression(summary, 1);
        return PerformCompressionResult.COMPRESSED;
      });
      expect(await runGuardedCompression(deps, 'test')).toBeUndefined();
      expect(await texts(history)).toStrictEqual(['committed summary']);
    } finally {
      await history.dispose();
    }
  });

  it('restores the saved journal version before propagating cancellation', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    try {
      await history.addBatch([createUserMessage('original')]);
      const abort = new DOMException('cancelled', 'AbortError');
      const deps = dependencies(history, async () => {
        await history.detachedValues.replace([createUserMessage('partial')]);
        throw abort;
      });
      await expect(runGuardedCompression(deps, 'test')).rejects.toBe(abort);
      expect(await texts(history)).toStrictEqual(['original']);
    } finally {
      await history.dispose();
    }
  });
});
