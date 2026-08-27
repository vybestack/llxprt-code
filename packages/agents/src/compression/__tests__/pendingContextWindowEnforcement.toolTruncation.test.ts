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
    applyFallbackCompressionResult: () => {},
    setSuppressDensityDirty: () => {},
    recordCompressionFailure: () => {},
    resetLastPromptTokenCount: () => {},
    getRuntimeModel: () => 'test-model',
    estimateBlockTokensAsync:
      overrides.estimateBlockTokensAsync ?? (async () => 100),
  };
}

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

    await expect(enforcer.enforce(0, 'prompt-1')).rejects.toThrow(
      /context limit/i,
    );
  });

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
        applyFallbackCompressionResult: (result, applyResult) => {
          if (result.kind === 'noop') return;
          applyResult(
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

      expect(observed).toStrictEqual([
        'contentAdded:rebuilt-1',
        'contentAdded:rebuilt-2',
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
