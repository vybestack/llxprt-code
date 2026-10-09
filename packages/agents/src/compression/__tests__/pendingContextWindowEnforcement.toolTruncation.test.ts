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

import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
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
import { installFixtureCandidate } from './provider-fallback-candidate-fixture.js';

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
    computeProjectedTokens: async (pt, cb) => {
      const baseline = historyService.getTotalTokens();
      return baseline + Math.max(0, pt) + cb;
    },
    ensureDensityOptimized: async () => {},
    performCompression: async () => PerformCompressionResult.FAILED,
    performFallbackCompression: async () => false,
    getLastPromptTokenCount: () => null,
    restoreLastPromptTokenCount: () => {},
    setSuppressDensityDirty: () => {},
    recordCompressionFailure: () => {},
    resetLastPromptTokenCount: () => {},
    getRuntimeModel: () => 'test-model',
    estimateBlockTokensAsync:
      overrides.estimateBlockTokensAsync ?? (async () => 100),
  };
}

let suite0HistoryService: HistoryService;

const suite0ObserveProducesAStructuredContextOverflowErrorWhenTheTruncatorRecalculationThrows =
  async () => {
    suite0HistoryService.add(textContent('human', 'hello'));
    suite0HistoryService.add(
      toolResponseContent('call-1', 'read_file', 'x'.repeat(100000)),
    );
    await suite0HistoryService.waitForTokenUpdates();

    // Override computeProjectedTokens so that calls inside the truncator
    // (computeProjected callback) throw. The truncator catch must produce
    // a structured overflow error rather than propagating the raw throw.
    // We make ALL calls succeed until we reach the truncation path, then
    // throw from there.
    let callCount = 0;
    const deps = buildEnforcerDeps(suite0HistoryService, {
      completionBudget: 100,
      marginAdjustedLimit: 100,
    });
    const originalCompute = deps.computeProjectedTokens;
    deps.computeProjectedTokens = async (pt, cb) => {
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

let suite1HistoryService: HistoryService;

describe('PendingContextWindowEnforcer structured overflow on estimator error (issue #1321)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    suite0HistoryService = new HistoryService();
  });

  it(
    'produces a structured context-overflow error when the async estimator throws',
    testBody0,
  );

  it(
    'produces a structured context-overflow error when the truncator recalculation throws',
    testBody1,
  );

  it(
    'produces a structured overflow when all reduction paths fail including tool truncation',
    testBody2,
  );

  it(
    'reports an applied fallback that does not commit candidate history',
    testBody3,
  );

  it(
    'restores the complete original state when an applied fallback rebuild fails',
    testBody4,
  );

  it('invalidates lineage after a successful fallback rebuild', testBody5);

  it('preserves lineage after a structural no-op fallback', testBody6);

  describe('PendingContextWindowEnforcer fallback rebuild under an active compression lock (#3338)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      suite1HistoryService = new HistoryService();
    });

    it(
      'runs the fallback clear/re-add inside one rebuild scope and keeps a late ordinary add streaming',
      testBody7,
    );
  });
});

async function testBody0(): Promise<void> {
  // Set up history with a tool response so the truncator has a candidate.
  suite0HistoryService.add(textContent('human', 'hello'));
  suite0HistoryService.add(
    toolResponseContent('call-1', 'read_file', 'x'.repeat(100000)),
  );
  await suite0HistoryService.waitForTokenUpdates();

  // The projected tokens exceed the limit so truncation is attempted.
  // The estimator throws during ranking — the enforcer must catch this
  // and produce a structured overflow error, not crash.
  const deps = buildEnforcerDeps(suite0HistoryService, {
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
}

async function testBody1(): Promise<void> {
  const { enforcer } =
    await suite0ObserveProducesAStructuredContextOverflowErrorWhenTheTruncatorRecalculationThrows();
  await expect(enforcer.enforce(0, 'prompt-1')).rejects.toThrow(
    /context limit/i,
  );
}

async function testBody2(): Promise<void> {
  // No tool responses at all — truncation has nothing to work with.
  suite0HistoryService.add(textContent('human', 'hello'));
  suite0HistoryService.add(textContent('ai', 'world'));
  await suite0HistoryService.waitForTokenUpdates();

  const deps = buildEnforcerDeps(suite0HistoryService, {
    completionBudget: 100,
    marginAdjustedLimit: 1,
  });

  const enforcer = new PendingContextWindowEnforcer(deps);

  await expect(enforcer.enforce(0, 'prompt-1')).rejects.toThrow(
    /context limit/i,
  );
}

async function testBody3(): Promise<void> {
  suite0HistoryService.add(textContent('human', 'history remains unchanged'));
  await suite0HistoryService.waitForTokenUpdates();

  const deps = buildEnforcerDeps(suite0HistoryService, {
    completionBudget: 100,
    marginAdjustedLimit: 1,
  });
  deps.performFallbackCompression = async () => true;

  await expect(
    new PendingContextWindowEnforcer(deps).enforce(
      0,
      'missing-fallback-commit',
    ),
  ).rejects.toThrow(/reported applied but no candidate history was committed/i);
  expect(
    (await collectRawHistory(suite0HistoryService))[0].blocks[0],
  ).toStrictEqual({
    type: 'text',
    text: 'history remains unchanged',
  });
}

async function testBody4(): Promise<void> {
  suite0HistoryService.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'original retained answer' }],
    metadata: {
      id: 'resp-original-parent',
      responsesStored: true,
      providerMetadata: { custom: 'original metadata' },
    },
  });
  suite0HistoryService.add(textContent('human', 'original follow-up'));
  await suite0HistoryService.waitForTokenUpdates();
  suite0HistoryService.setBaseTokenOffset(37);
  const chronologySeqs: number[] = [];
  for await (const entry of suite0HistoryService.getChronologyTrace()) {
    chronologySeqs.push(entry.seq);
  }
  const anchor = chronologySeqs[0];
  suite0HistoryService.setCacheAnchorSeq(anchor);
  const originalHistory = [...(await collectRawHistory(suite0HistoryService))];
  const originalHistoryTokens =
    await suite0HistoryService.estimateTokensForContents(originalHistory);

  const deps = buildEnforcerDeps(suite0HistoryService, {
    completionBudget: 100,
    marginAdjustedLimit: 1,
  });
  deps.performFallbackCompression = async (_prompt, install) => {
    await installFixtureCandidate(install, [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'candidate rewrite' }],
        metadata: {
          id: 'resp-candidate',
          responsesStored: true,
        },
      },
    ]);
    return true;
  };
  suite0HistoryService.on('tokensUpdated', () => {
    throw new Error('injected rebuild failure');
  });

  await expect(
    new PendingContextWindowEnforcer(deps).enforce(0, 'failed-rebuild'),
  ).rejects.toThrow(/context limit/i);

  expect(await collectRawHistory(suite0HistoryService)).toStrictEqual(
    originalHistory,
  );
  expect(suite0HistoryService.getTotalTokens()).toBe(
    originalHistoryTokens + 37,
  );
  expect(suite0HistoryService.getCacheAnchorSeq()).toBe(anchor);
  expect(
    (await collectRawHistory(suite0HistoryService))[0].metadata
      ?.responsesStored,
  ).toBe(true);
  expect((await collectRawHistory(suite0HistoryService))[0].metadata?.id).toBe(
    'resp-original-parent',
  );
}

async function testBody5(): Promise<void> {
  suite0HistoryService.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'x'.repeat(10_000) }],
    metadata: {
      id: 'resp-before-fallback',
      responsesStored: true,
      providerMetadata: { custom: 'preserve me' },
    },
  });
  await suite0HistoryService.waitForTokenUpdates();

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
  const deps = buildEnforcerDeps(suite0HistoryService, {
    completionBudget: 100,
    marginAdjustedLimit: 500,
  });
  deps.performFallbackCompression = async (_prompt, install) => {
    await installFixtureCandidate(install, fallbackHistory);
    return true;
  };

  const enforcer = new PendingContextWindowEnforcer(deps);

  await enforcer.enforce(0, 'successful-fallback');

  expect(
    (await collectRawHistory(suite0HistoryService))[0].metadata,
  ).toMatchObject({
    id: 'resp-in-fallback',
    providerMetadata: { custom: 'fallback metadata' },
  });
  expect(
    (await collectRawHistory(suite0HistoryService))[0].metadata
      ?.responsesStored,
  ).toBeUndefined();
}

async function testBody6(): Promise<void> {
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
  noOpDeps.performFallbackCompression = async () => false;

  await expect(
    new PendingContextWindowEnforcer(noOpDeps).enforce(0, 'noop-fallback'),
  ).rejects.toThrow(/context limit/i);
  expect((await collectRawHistory(noOpHistory))[0].metadata).toMatchObject({
    id: 'resp-noop',
    responsesStored: true,
    providerMetadata: { custom: 'unchanged metadata' },
  });
}

async function testBody7(): Promise<void> {
  // Seed large history so every projection stays over the hard limit until the
  // fallback truncation shrinks it. The real enforcer reaches the fallback on
  // its own (auto compression fails), and the fallback's applyResult runs the
  // migrated rebuildWith path on the real HistoryService.
  suite1HistoryService.add(textContent('human', 'hello'));
  suite1HistoryService.add(
    toolResponseContent('call-big', 'read_file', 'x'.repeat(100000)),
  );
  await suite1HistoryService.waitForTokenUpdates();

  const deps: PendingContextWindowEnforcerDeps = {
    ...buildEnforcerDeps(suite1HistoryService, {
      completionBudget: 100,
      marginAdjustedLimit: 10_000,
    }),
    performFallbackCompression: async (_prompt, install) => {
      await installFixtureCandidate(install, [
        textContent('ai', 'rebuilt-1'),
        textContent('ai', 'rebuilt-2'),
      ]);
      return true;
    },
  };
  const enforcer = new PendingContextWindowEnforcer(deps);

  const observed: string[] = [];
  suite1HistoryService.on('contentAdded', (content) => {
    const block = content.blocks[0];
    observed.push(
      `contentAdded:${block.type === 'text' ? block.text : block.type}`,
    );
  });
  suite1HistoryService.on('compressionLockReleased', () => {
    observed.push('compressionLockReleased');
  });
  suite1HistoryService.on('compressionEnded', () => {
    observed.push('compressionEnded');
  });

  suite1HistoryService.startCompression();
  await enforcer.enforce(0, 'prompt-3338');
  suite1HistoryService.add(textContent('ai', 'late stream after enforce'));
  suite1HistoryService.endCompression(
    textContent('ai', 'truncation summary'),
    3,
  );

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

  await collectRowsForAssertions(
    suite1HistoryService.getComprehensive(),
    async (contentsForAssertions) => {
      const texts = contentsForAssertions.map((entry) => {
        const block = entry.blocks[0];
        return block.type === 'text' ? block.text : `<${block.type}>`;
      });
      expect(texts).toStrictEqual([
        'rebuilt-1',
        'rebuilt-2',
        'late stream after enforce',
      ]);
    },
  );
}
