/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for PendingContextWindowEnforcer last-resort
 * tool-response truncation error handling (issue #1321).
 *
 * Verifies that when the async estimator or token recalculation throws
 * during tool-response truncation, the enforcer catches the error and
 * produces a structured context-overflow error rather than crashing
 * with an unstructured exception.
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  PendingContextWindowEnforcer,
  type PendingContextWindowEnforcerDeps,
} from '../pendingContextWindowEnforcement.js';

function makeLogger(): DebugLogger {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as DebugLogger;
}

function textContent(speaker: IContent['speaker'], text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function toolResponseContent(
  callId: string,
  toolName: string,
  result: string,
): IContent {
  return {
    speaker: 'tool',
    blocks: [{ type: 'tool_response', callId, toolName, result }],
  };
}

function buildEnforcerDeps(
  historyService: HistoryService,
  overrides: {
    estimateBlockTokensAsync?: (block: ContentBlock) => Promise<number>;
    completionBudget?: number;
    limit?: number;
    marginAdjustedLimit?: number;
    pendingTokens?: number;
  } = {},
): PendingContextWindowEnforcerDeps {
  const completionBudget = overrides.completionBudget ?? 100;
  const limit = overrides.limit ?? 15000;
  const marginAdjustedLimit = overrides.marginAdjustedLimit ?? 14000;

  return {
    historyService,
    logger: makeLogger(),
    ineffectiveCompressionReductionThreshold: 0.05,
    getContextLimits: () => ({ completionBudget, limit, marginAdjustedLimit }),
    computeProjectedTokens: (pt, cb) => {
      const baseline = historyService.getTotalTokens();
      return baseline + Math.max(0, pt) + cb;
    },
    ensureDensityOptimized: async () => {},
    performCompression: async () => PerformCompressionResult.FAILED,
    buildCompressionContext: async () => ({}) as never,
    compressWithFallbackStrategy: async () => ({ newHistory: [] }) as never,
    applyFallbackCompressionResult: async () => {},
    setSuppressDensityDirty: () => {},
    recordCompressionFailure: () => {},
    resetLastPromptTokenCount: () => {},
    getRuntimeModel: () => 'test-model',
    estimateBlockTokensAsync:
      overrides.estimateBlockTokensAsync ?? (async () => 100),
  };
}

const applyFallbackCompressionResult: PendingContextWindowEnforcerDeps['applyFallbackCompressionResult'] =
  async (result, applyResult) => {
    if (result.kind === 'applied') {
      await applyResult(
        result.newHistory,
        result.newHistory[0],
        result.metadata.topPreserved ?? 0,
      );
    }
  };

describe('PendingContextWindowEnforcer structured overflow on estimator error (issue #1321)', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    historyService = new HistoryService();
  });

  it('produces a structured context-overflow error when the async estimator throws', async () => {
    // Set up history with a tool response so the truncator has a candidate.
    historyService.add(textContent('human', 'hello'));
    historyService.add(
      toolResponseContent('call-1', 'read_file', 'x'.repeat(100000)),
    );
    await historyService.waitForTokenUpdates();

    // The projected tokens exceed the limit so truncation is attempted.
    // The estimator throws during ranking — the enforcer must catch this
    // and produce a structured overflow error, not crash.
    const deps = buildEnforcerDeps(historyService, {
      completionBudget: 100,
      marginAdjustedLimit: 100,
      estimateBlockTokensAsync: async () => {
        throw new Error('estimator blew up');
      },
    });

    const enforcer = new PendingContextWindowEnforcer(deps);

    await expect(enforcer.enforce(0, 'prompt-1')).rejects.toThrow(
      /context limit/i,
    );
  });

  it('produces a structured context-overflow error when the truncator recalculation throws', async () => {
    const { enforcer } =
      await observeProducesAStructuredContextOverflowErrorWhenTheTruncatorRecalculationThrows();
    await expect(enforcer.enforce(0, 'prompt-1')).rejects.toThrow(
      /context limit/i,
    );
  });

  const observeProducesAStructuredContextOverflowErrorWhenTheTruncatorRecalculationThrows =
    async () => {
      historyService.add(textContent('human', 'hello'));
      historyService.add(
        toolResponseContent('call-1', 'read_file', 'x'.repeat(100000)),
      );
      await historyService.waitForTokenUpdates();

      // Override computeProjectedTokens so that calls inside the truncator
      // (computeProjected callback) throw. The truncator catch must produce
      // a structured overflow error rather than propagating the raw throw.
      // We make ALL calls succeed until we reach the truncation path, then
      // throw from there.
      let callCount = 0;
      const deps = buildEnforcerDeps(historyService, {
        completionBudget: 100,
        marginAdjustedLimit: 100,
      });
      const originalCompute = deps.computeProjectedTokens;
      deps.computeProjectedTokens = (pt, cb) => {
        callCount++;
        // After the enforcer reaches the truncation path (many calls have
        // already happened for initial/compression projections), throw to
        // simulate a recalculation error inside the truncator.
        if (callCount > 5) {
          throw new Error('truncator recalculation failed');
        }
        return originalCompute(pt, cb);
      };

      const enforcer = new PendingContextWindowEnforcer(deps);

      return { enforcer };
    };

  it('produces a structured overflow when all reduction paths fail including tool truncation', async () => {
    // No tool responses at all — truncation has nothing to work with.
    historyService.add(textContent('human', 'hello'));
    historyService.add(textContent('ai', 'world'));
    await historyService.waitForTokenUpdates();

    const deps = buildEnforcerDeps(historyService, {
      completionBudget: 100,
      marginAdjustedLimit: 1,
    });

    const enforcer = new PendingContextWindowEnforcer(deps);

    await expect(enforcer.enforce(0, 'prompt-1')).rejects.toThrow(
      /context limit/i,
    );
  });

  it('reports an applied fallback that does not commit candidate history', async () => {
    historyService.add(textContent('human', 'history remains unchanged'));
    await historyService.waitForTokenUpdates();

    const deps = buildEnforcerDeps(historyService, {
      completionBudget: 100,
      marginAdjustedLimit: 1,
    });
    deps.compressWithFallbackStrategy = async () => ({
      kind: 'applied',
      newHistory: [textContent('human', 'candidate was never committed')],
      metadata: {
        originalMessageCount: 1,
        compressedMessageCount: 1,
        strategyUsed: 'top-down-truncation',
        llmCallMade: false,
      },
    });

    await expect(
      new PendingContextWindowEnforcer(deps).enforce(
        0,
        'missing-fallback-commit',
      ),
    ).rejects.toThrow(
      /reported applied but no candidate history was committed/i,
    );
    expect(historyService.getRawHistory()[0].blocks[0]).toStrictEqual({
      type: 'text',
      text: 'history remains unchanged',
    });
  });

  it('restores the complete original state when an applied fallback rebuild fails', async () => {
    historyService.add({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'original retained answer' }],
      metadata: {
        id: 'resp-original-parent',
        responsesStored: true,
        providerMetadata: { custom: 'original metadata' },
      },
    });
    historyService.add(textContent('human', 'original follow-up'));
    await historyService.waitForTokenUpdates();
    historyService.setBaseTokenOffset(37);
    const anchor = historyService.getChronologyTrace()[0].seq;
    historyService.setCacheAnchorSeq(anchor);
    const originalHistory = [...historyService.getRawHistory()];
    const originalHistoryTokens =
      await historyService.estimateTokensForContents(originalHistory);

    const deps = buildEnforcerDeps(historyService, {
      completionBudget: 100,
      marginAdjustedLimit: 1,
    });
    deps.compressWithFallbackStrategy = async () => ({
      kind: 'applied',
      newHistory: [
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'candidate rewrite' }],
          metadata: {
            id: 'resp-candidate',
            responsesStored: true,
          },
        },
      ],
      metadata: {
        originalMessageCount: 2,
        compressedMessageCount: 1,
        strategyUsed: 'top-down-truncation',
        llmCallMade: false,
      },
    });
    deps.applyFallbackCompressionResult = applyFallbackCompressionResult;
    historyService.on('tokensUpdated', () => {
      throw new Error('injected rebuild failure');
    });

    await expect(
      new PendingContextWindowEnforcer(deps).enforce(0, 'failed-rebuild'),
    ).rejects.toThrow(/context limit/i);

    expect(historyService.getRawHistory()).toStrictEqual(originalHistory);
    expect(historyService.getTotalTokens()).toBe(originalHistoryTokens + 37);
    expect(historyService.getCacheAnchorSeq()).toBe(anchor);
    expect(historyService.getRawHistory()[0].metadata?.responsesStored).toBe(
      true,
    );
    expect(historyService.getRawHistory()[0].metadata?.id).toBe(
      'resp-original-parent',
    );
  });

  it('invalidates lineage after a successful fallback rebuild but preserves a structural no-op lineage', async () => {
    historyService.add({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'x'.repeat(10_000) }],
      metadata: {
        id: 'resp-before-fallback',
        responsesStored: true,
        providerMetadata: { custom: 'preserve me' },
      },
    });
    await historyService.waitForTokenUpdates();

    const fallbackHistory: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'short fallback summary' }],
        metadata: {
          id: 'resp-in-fallback',
          responsesStored: true,
          providerMetadata: { custom: 'fallback metadata' },
        },
      },
    ];
    const deps = buildEnforcerDeps(historyService, {
      completionBudget: 100,
      marginAdjustedLimit: 500,
    });
    deps.compressWithFallbackStrategy = async () => ({
      kind: 'applied',
      newHistory: fallbackHistory,
      metadata: {
        originalMessageCount: 1,
        compressedMessageCount: 1,
        strategyUsed: 'top-down-truncation',
        llmCallMade: false,
      },
    });
    deps.applyFallbackCompressionResult = applyFallbackCompressionResult;

    const enforcer = new PendingContextWindowEnforcer(deps);

    await enforcer.enforce(0, 'successful-fallback');

    expect(historyService.getRawHistory()[0].metadata).toMatchObject({
      id: 'resp-in-fallback',
      providerMetadata: { custom: 'fallback metadata' },
    });
    expect(
      historyService.getRawHistory()[0].metadata?.responsesStored,
    ).toBeUndefined();

    const noOpHistory = new HistoryService();
    noOpHistory.add({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'x'.repeat(10_000) }],
      metadata: {
        id: 'resp-noop',
        responsesStored: true,
        providerMetadata: { custom: 'unchanged metadata' },
      },
    });
    await noOpHistory.waitForTokenUpdates();
    const noOpDeps = buildEnforcerDeps(noOpHistory, {
      completionBudget: 100,
      marginAdjustedLimit: 1,
    });
    noOpDeps.compressWithFallbackStrategy = async () => ({
      kind: 'noop',
      reason: 'already-under-target',
      metadata: {
        originalMessageCount: 1,
        compressedMessageCount: 1,
        strategyUsed: 'top-down-truncation',
        llmCallMade: false,
      },
    });
    noOpDeps.applyFallbackCompressionResult = applyFallbackCompressionResult;

    await expect(
      new PendingContextWindowEnforcer(noOpDeps).enforce(0, 'noop-fallback'),
    ).rejects.toThrow(/context limit/i);
    expect(noOpHistory.getRawHistory()[0].metadata).toMatchObject({
      id: 'resp-noop',
      responsesStored: true,
      providerMetadata: { custom: 'unchanged metadata' },
    });
  });

  describe('PendingContextWindowEnforcer fallback rebuild under an active compression lock (#3338)', () => {
    let historyService: HistoryService;

    beforeEach(() => {
      vi.clearAllMocks();
      historyService = new HistoryService();
    });

    it('runs the fallback clear/re-add inside one rebuild scope and keeps a late ordinary add streaming', async () => {
      // Seed large history so every projection stays over the hard limit until the
      // fallback truncation shrinks it. The real enforcer reaches the fallback on
      // its own (auto compression fails), and the fallback's applyResult runs the
      // migrated rebuildWith path on the real HistoryService.
      historyService.add(textContent('human', 'hello'));
      historyService.add(
        toolResponseContent('call-big', 'read_file', 'x'.repeat(100000)),
      );
      await historyService.waitForTokenUpdates();

      const deps: PendingContextWindowEnforcerDeps = {
        ...buildEnforcerDeps(historyService, {
          completionBudget: 100,
          marginAdjustedLimit: 10_000,
        }),
        compressWithFallbackStrategy: async () => ({
          kind: 'applied',
          newHistory: [
            textContent('ai', 'rebuilt-1'),
            textContent('ai', 'rebuilt-2'),
          ],
          metadata: {
            originalMessageCount: 2,
            compressedMessageCount: 2,
            strategyUsed: 'top-down-truncation',
            llmCallMade: false,
            topPreserved: 0,
          },
        }),
        applyFallbackCompressionResult: async (result, applyResult) => {
          if (result.kind === 'noop') return;
          await applyResult(
            result.newHistory,
            undefined,
            result.metadata.topPreserved ?? 0,
          );
        },
      };
      const enforcer = new PendingContextWindowEnforcer(deps);

      const observed: string[] = [];
      historyService.on('contentAdded', (content) => {
        const block = content.blocks[0];
        observed.push(
          `contentAdded:${block.type === 'text' ? block.text : block.type}`,
        );
      });
      historyService.on('compressionLockReleased', () => {
        observed.push('compressionLockReleased');
      });
      historyService.on('compressionEnded', () => {
        observed.push('compressionEnded');
      });

      historyService.startCompression();
      await enforcer.enforce(0, 'prompt-3338');
      historyService.add(textContent('ai', 'late stream after enforce'));
      historyService.endCompression(textContent('ai', 'truncation summary'), 3);

      // #3264 replaced the clear/re-add loop with an atomic
      // HistoryService.replaceAll, so a rebuild no longer announces its own
      // entries as newly added content -- which is right, since nothing new
      // arrived. What #3338 is about is the entry that arrives afterwards, and
      // that one still streams.
      expect(observed).toStrictEqual([
        'compressionLockReleased',
        'compressionEnded',
        'contentAdded:late stream after enforce',
      ]);

      const texts = historyService.getAll().map((entry) => {
        const block = entry.blocks[0];
        return block.type === 'text' ? block.text : `<${block.type}>`;
      });
      expect(texts).toStrictEqual([
        'rebuilt-1',
        'rebuilt-2',
        'late stream after enforce',
      ]);
    });
  });
});
