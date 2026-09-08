/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for CompressionHandler provider fallback failure
 * propagation and stage-aware projection errors (Issue #2588 findings).
 *
 * Finding 1: When the real provider fallback path (top-down truncation or
 * buildCompressionContext) fails during hard-limit enforcement, the failure
 * cause must propagate to the final overflow diagnostics. Previously the
 * error was swallowed at two layers (the createProviderContentEnforcer lambda
 * catches and returns false; CompressionHandler.performFallbackCompression
 * also catches and returns false), so truncationFailure was never set and the
 * final overflow error lost the cause.
 *
 * Finding 2: When estimateTokensForContents rejects after compression, retry,
 * or truncation mutations, the error must include stage/action context so the
 * caller can diagnose which stage failed. Previously the raw projection error
 * bubbled up ambiguously.
 *
 * These tests follow dev-docs/RULES.md: they assert observable behavior
 * (error messages, content preservation) and NEVER assert that mock functions
 * were called with specific arguments.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  makeUserMessage,
  buildRuntimeContext,
} from '../../core/__tests__/chatSession-density-helpers.js';
import {
  ProviderContentEnforcer,
  type ProviderContentEnforcementDeps,
} from '../providerContentEnforcement.js';
import { CompressionHandler } from '../CompressionHandler.js';
import * as compressionFactory from '../compressionStrategyFactory.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  EmptySummaryError,
  type CompressionProviderResult,
  type CompressionStrategy,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderContentEnvelope } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';

function makeLogger(): DebugLogger {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as DebugLogger;
}

function makeStoredAi(id: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text: `stored answer ${id}` }],
    metadata: {
      id,
      responsesStored: true,
      providerBaseURL: 'https://api.openai.com/v1',
      providerMetadata: { custom: `metadata ${id}` },
    },
  };
}

const original = { ...(await import('@vybestack/llxprt-code-settings')) };
void vi.mock('@vybestack/llxprt-code-settings', () => ({
  ...original,
  Storage: new Proxy(original.Storage, {
    get(target, property, receiver) {
      return property === 'getGlobalConfigDir'
        ? vi.fn(() => '/tmp/llxprt-test-config')
        : Reflect.get(target, property, receiver);
    },
  }),
}));

interface BookkeepingStrategyControl {
  activateCandidateAfter(noopCalls: number): void;
}

async function seedFallbackCooldown(
  handler: CompressionHandler,
  candidateHistory: IContent[],
): Promise<BookkeepingStrategyControl> {
  let candidateActive = false;
  let targetCallCount = 0;
  let targetNoopCalls = 0;
  const strategy: CompressionStrategy = {
    name: 'top-down-truncation',
    requiresLLM: false,
    trigger: { mode: 'threshold', defaultThreshold: 0.8 },
    compress: async () => {
      if (!candidateActive) {
        throw new EmptySummaryError('top-down-truncation');
      }
      targetCallCount += 1;
      if (targetCallCount <= targetNoopCalls) {
        return {
          kind: 'noop',
          reason: 'bookkeeping-test-auto-compression-noop',
          metadata: {
            originalMessageCount: 1,
            compressedMessageCount: 1,
            strategyUsed: 'top-down-truncation',
            llmCallMade: false,
          },
        };
      }
      return {
        kind: 'applied',
        newHistory: candidateHistory,
        metadata: {
          originalMessageCount: 1,
          compressedMessageCount: candidateHistory.length,
          strategyUsed: 'top-down-truncation',
          llmCallMade: false,
        },
      };
    },
  };
  vi.spyOn(compressionFactory, 'getCompressionStrategy').mockReturnValue(
    strategy,
  );

  await handler.performCompression('seed-failure-1');
  await handler.performCompression('seed-failure-2');
  await handler.performCompression('seed-failure-3');

  return {
    activateCandidateAfter: (noopCalls) => {
      targetNoopCalls = noopCalls;
      candidateActive = true;
    },
  };
}

function makeCompressionSnapshot(label: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: label }],
    metadata: {
      synthetic: true,
      isSummary: true,
      reason: 'compression-state-snapshot',
    },
  };
}

function estimateBookkeepingProjection(contents: IContent[]): Promise<number> {
  const hasCommittedSnapshot = contents.some((content) =>
    content.blocks.some(
      (block) =>
        block.type === 'text' && block.text.includes('committed snapshot'),
    ),
  );
  return Promise.resolve(hasCommittedSnapshot ? 10 : 150_000);
}

function restoredPromptTokenBaseline(baseline: number | null): number {
  return baseline ?? 0;
}

// ---------------------------------------------------------------------------
// Finding 1: Provider fallback failure propagation through real wiring
// ---------------------------------------------------------------------------

describe('Finding 1: provider fallback failure propagation through real CompressionHandler (Issue #2588)', () => {
  let historyService: HistoryService;
  let runtimeContext: AgentRuntimeContext;
  let handler: CompressionHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    historyService = new HistoryService();
    runtimeContext = buildRuntimeContext(historyService, {
      contextLimit: 200_000,
      compressionThreshold: 0.8,
      compressionStrategy: 'top-down-truncation',
    });

    const provider = {
      name: 'test',
      generateChatCompletion: vi.fn(),
    } as unknown as RuntimeProvider;
    const providerResult: CompressionProviderResult = { provider };
    handler = new CompressionHandler(
      runtimeContext,
      historyService,
      {},
      vi.fn().mockResolvedValue(providerResult),
      vi.fn().mockResolvedValue(undefined),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * When the top-down-truncation fallback strategy throws during
   * enforceProviderContents hard-limit enforcement, the error must propagate
   * as truncationFailure in the final overflow diagnostics.
   */
  it('propagates fallback truncation failure cause into the final overflow error', async () => {
    historyService.add(makeUserMessage('established history'));
    historyService.add(makeStoredAi('resp-preserved-on-failure'));

    const pending = makeUserMessage('pending request');
    const envelope: ProviderContentEnvelope = {
      contents: historyService.getCuratedForProvider([pending]),
      pendingContents: [pending],
    };

    vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
      150_000,
    );

    vi.spyOn(handler, 'performCompression').mockResolvedValue(
      PerformCompressionResult.COMPRESSED,
    );

    const strategy: CompressionStrategy = {
      name: 'top-down-truncation',
      requiresLLM: false,
      trigger: { mode: 'threshold', defaultThreshold: 0.8 },
      compress: vi
        .fn()
        .mockRejectedValue(new Error('truncation engine blew up')),
    };
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockReturnValue(
      strategy,
    );

    let thrownError: Error | undefined;
    try {
      await handler.enforceProviderContents(envelope, 'test-prompt');
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError?.message).toContain(
      'Truncation fallback failed during hard-limit enforcement',
    );
    expect(thrownError!.message).toContain('truncation engine blew up');
    expect(historyService.getRawHistory()[1].metadata?.responsesStored).toBe(
      true,
    );
    expect(historyService.getRawHistory()[1].metadata?.id).toBe(
      'resp-preserved-on-failure',
    );
  });

  /**
   * When buildCompressionContext fails during the provider fallback path,
   * the error must also propagate as truncationFailure.
   */
  it('propagates buildCompressionContext failure cause into the final overflow error', async () => {
    historyService.add(makeUserMessage('established history'));

    const pending = makeUserMessage('pending request');
    const envelope: ProviderContentEnvelope = {
      contents: historyService.getCuratedForProvider([pending]),
      pendingContents: [pending],
    };

    vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
      150_000,
    );

    vi.spyOn(handler, 'performCompression').mockResolvedValue(
      PerformCompressionResult.COMPRESSED,
    );

    vi.spyOn(handler, 'buildCompressionContext').mockRejectedValue(
      new Error('context build exploded'),
    );

    let thrownError: Error | undefined;
    try {
      await handler.enforceProviderContents(envelope, 'test-prompt');
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError?.message).toContain(
      'Truncation fallback failed during hard-limit enforcement',
    );
    expect(thrownError?.message).toContain('context build exploded');
  });

  /**
   * When the fallback strategy succeeds, the normal happy path should work.
   *
   * Compression is simulated at the handler boundary. Scripted projections
   * keep the initial, post-density, and post-first-compression payloads over
   * limit while making the simulated first compression effective enough to
   * bypass retry. Only the post-truncation projection fits, proving that the
   * real handler-to-fallback wiring applied the strategy result instead of
   * returning early from an earlier stage. The returned contents must
   * contain the truncated summary and preserve the pending message.
   */
  it('still succeeds when fallback truncation works correctly', async () => {
    historyService.add(makeUserMessage('established history'));

    const pending = makeUserMessage('pending request');
    const envelope: ProviderContentEnvelope = {
      contents: historyService.getCuratedForProvider([pending]),
      pendingContents: [pending],
    };

    // contextLimit = 200_000, completionBudget = 65_536
    // marginAdjustedLimit = 199_995 → over-limit when projected > 199_995
    // estimate + 65_536 > 199_995 → estimate > 134_459
    const OVER_LIMIT_ESTIMATE = 150_000; // 150_000 + 65_536 = 215_536 > 199_995
    const TRUNCATED_SUMMARY_ESTIMATE = 50_000; // 50_000 + 65_536 = 115_536 < 199_995

    const estimateSpy = vi.spyOn(historyService, 'estimateTokensForContents');
    // 1. Initial projection — over-limit
    estimateSpy.mockResolvedValueOnce(OVER_LIMIT_ESTIMATE);
    // 2. Post-density-optimization — over-limit
    estimateSpy.mockResolvedValueOnce(OVER_LIMIT_ESTIMATE);
    // 3. Post-first-compression — still over-limit, but effective enough to
    //    avoid retry (reduction >= 5% of pre-compression projection).
    //    pre-compression projected = 215_536, need reduction >= ~10_777,
    //    so post-compression estimate <= 139_223 keeps ratio >= 5%.
    //    135_000 + 65_536 = 200_536 > 199_995 (still over margin limit).
    estimateSpy.mockResolvedValueOnce(135_000);
    // 4. Post-truncation — under-limit (fallback succeeded)
    estimateSpy.mockResolvedValueOnce(TRUNCATED_SUMMARY_ESTIMATE);

    vi.spyOn(handler, 'performCompression').mockResolvedValue(
      PerformCompressionResult.COMPRESSED,
    );

    const fallbackHistory = [
      makeStoredAi('resp-fallback-1'),
      makeUserMessage('truncated summary'),
      makeStoredAi('resp-fallback-2'),
    ];
    const strategy: CompressionStrategy = {
      name: 'top-down-truncation',
      requiresLLM: false,
      trigger: { mode: 'threshold', defaultThreshold: 0.8 },
      compress: vi.fn().mockResolvedValue({
        newHistory: fallbackHistory,
        metadata: {
          originalMessageCount: 1,
          compressedMessageCount: 1,
          strategyUsed: 'top-down-truncation',
          llmCallMade: false,
        },
      }),
    };
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockReturnValue(
      strategy,
    );
    handler.setLastPromptTokenCount(123);

    let incrementalPublications = 0;
    historyService.on('contentAdded', () => {
      incrementalPublications += 1;
    });

    const result = await handler.enforceProviderContents(
      envelope,
      'test-prompt',
    );

    // The truncated summary content must appear in the returned provider
    // contents, proving the fallback path applied its result.
    const resultText = result
      .flatMap((c) => c.blocks)
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join(' ');
    expect(resultText).toContain('truncated summary');

    // The pending request must be preserved in the returned contents.
    expect(result).toContainEqual(pending);

    const rewrittenHistory = historyService.getRawHistory();
    expect(rewrittenHistory[0].metadata).toMatchObject({
      id: 'resp-fallback-1',
      providerBaseURL: 'https://api.openai.com/v1',
      providerMetadata: { custom: 'metadata resp-fallback-1' },
    });
    expect(rewrittenHistory[0].metadata?.responsesStored).toBeUndefined();
    expect(rewrittenHistory[2].metadata).toMatchObject({
      id: 'resp-fallback-2',
      providerBaseURL: 'https://api.openai.com/v1',
      providerMetadata: { custom: 'metadata resp-fallback-2' },
    });
    expect(rewrittenHistory[2].metadata?.responsesStored).toBeUndefined();
    expect(handler.getLastPromptTokenCount()).toBe(0);
    expect(incrementalPublications).toBe(0);
  });

  it('keeps pending fallback failure bookkeeping when candidate commit rejects', async () => {
    historyService.add(makeUserMessage('established history'));
    await historyService.waitForTokenUpdates();
    const snapshot = makeCompressionSnapshot(
      'pending rejected committed snapshot',
    );
    const control = await seedFallbackCooldown(handler, [snapshot]);
    expect(handler['compressionFailureCount']).toBe(3);
    control.activateCandidateAfter(2);
    handler.setLastPromptTokenCount(150_000);
    vi.spyOn(historyService, 'replaceAll').mockRejectedValue(
      new Error('pending candidate commit rejected'),
    );

    await expect(
      handler.enforceContextWindow(0, 'pending-rejected-commit'),
    ).rejects.toThrow(/context limit/i);

    expect(handler['compressionFailureCount']).toBe(4);
    expect(handler['compressionSummary']).toBeUndefined();
    expect(handler['lastSuccessfulCompressionTime']).toBeNull();
    expect(handler.isCompressionInCooldown()).toBe(true);
    expect(handler.wasRecentlyCompressed()).toBe(false);
  });

  it('keeps provider fallback failure bookkeeping when candidate commit rejects', async () => {
    historyService.add(makeUserMessage('established history'));
    await historyService.waitForTokenUpdates();
    const snapshot = makeCompressionSnapshot(
      'provider rejected committed snapshot',
    );
    const control = await seedFallbackCooldown(handler, [snapshot]);
    expect(handler['compressionFailureCount']).toBe(3);
    control.activateCandidateAfter(1);
    vi.spyOn(historyService, 'replaceAll').mockRejectedValue(
      new Error('provider candidate commit rejected'),
    );
    const pending = makeUserMessage('pending request');

    await expect(
      handler.enforceProviderContents(
        {
          contents: historyService.getCuratedForProvider([pending]),
          pendingContents: [pending],
        },
        'provider-rejected-commit',
        undefined,
        estimateBookkeepingProjection,
      ),
    ).rejects.toThrow(/context limit/i);

    expect(handler['compressionFailureCount']).toBe(4);
    expect(handler['compressionSummary']).toBeUndefined();
    expect(handler['lastSuccessfulCompressionTime']).toBeNull();
    expect(handler.isCompressionInCooldown()).toBe(true);
    expect(handler.wasRecentlyCompressed()).toBe(false);
  });

  it('publishes pending fallback success bookkeeping after candidate commit', async () => {
    historyService.add(makeUserMessage('established history'));
    await historyService.waitForTokenUpdates();
    const snapshot = makeCompressionSnapshot(
      'pending successful committed snapshot',
    );
    const control = await seedFallbackCooldown(handler, [snapshot]);
    expect(handler['compressionFailureCount']).toBe(3);
    control.activateCandidateAfter(2);
    handler.setLastPromptTokenCount(150_000);

    await handler.enforceContextWindow(0, 'pending-successful-commit');

    expect(handler['compressionFailureCount']).toBe(0);
    expect(handler['compressionSummary']).toBe(snapshot);
    expect(handler['lastSuccessfulCompressionTime']).not.toBeNull();
    expect(handler.isCompressionInCooldown()).toBe(false);
    expect(handler.wasRecentlyCompressed()).toBe(true);
    expect(historyService.getRawHistory()).toHaveLength(1);
    expect(historyService.getRawHistory()[0].blocks[0]).toMatchObject({
      type: 'text',
      text: 'pending successful committed snapshot',
    });
  });

  it('publishes provider fallback success bookkeeping after candidate commit', async () => {
    historyService.add(makeUserMessage('established history'));
    await historyService.waitForTokenUpdates();
    const snapshot = makeCompressionSnapshot(
      'provider successful committed snapshot',
    );
    const control = await seedFallbackCooldown(handler, [snapshot]);
    expect(handler['compressionFailureCount']).toBe(3);
    control.activateCandidateAfter(1);
    const pending = makeUserMessage('pending request');

    const contents = await handler.enforceProviderContents(
      {
        contents: historyService.getCuratedForProvider([pending]),
        pendingContents: [pending],
      },
      'provider-successful-commit',
      undefined,
      estimateBookkeepingProjection,
    );

    expect(handler['compressionFailureCount']).toBe(0);
    expect(handler['compressionSummary']).toBe(snapshot);
    expect(handler['lastSuccessfulCompressionTime']).not.toBeNull();
    expect(handler.isCompressionInCooldown()).toBe(false);
    expect(handler.wasRecentlyCompressed()).toBe(true);
    expect(contents).toContainEqual(snapshot);
    expect(contents).toContainEqual(pending);
  });
});

// ---------------------------------------------------------------------------
// Finding 2: Stage-aware projection errors in ProviderContentEnforcer
// ---------------------------------------------------------------------------

describe('Finding 2: stage-aware projection errors in ProviderContentEnforcer (Issue #2588)', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    historyService = new HistoryService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  interface EnforcerHarness {
    enforcer: ProviderContentEnforcer;
    deps: ProviderContentEnforcementDeps;
  }

  function buildEnforcerHarness(
    overrides: Partial<ProviderContentEnforcementDeps> = {},
  ): EnforcerHarness {
    const runtimeContext = buildRuntimeContext(historyService, {
      contextLimit: 200_000,
      compressionThreshold: 0.8,
    });
    const deps: ProviderContentEnforcementDeps = {
      historyService,
      runtimeContext,
      generationConfig: {},
      providerRuntimeNullable: undefined,
      logger: makeLogger(),
      ensureDensityOptimized: vi.fn().mockResolvedValue(undefined),
      performCompression: vi.fn(),
      performFallbackCompression: vi.fn().mockResolvedValue(false),
      getPromptTokenBaseline: () => null,
      resetPromptTokenBaseline: () => {},
      restorePromptTokenBaseline: () => {},
      ...overrides,
    };
    return { enforcer: new ProviderContentEnforcer(deps), deps };
  }

  it('preserves all history state when fallback candidate installation fails', async () => {
    historyService.add(makeStoredAi('resp-original-parent'));
    historyService.add(makeUserMessage('original follow-up'));
    await historyService.waitForTokenUpdates();
    historyService.setBaseTokenOffset(37);
    const [anchorEntry] = historyService.getChronologyTrace();
    historyService.setCacheAnchorSeq(anchorEntry.seq);
    const originalHistory = [...historyService.getRawHistory()];
    const originalHistoryTokens =
      await historyService.estimateTokensForContents(originalHistory);
    let promptTokenBaseline = 123;

    const harness = buildEnforcerHarness({
      estimateFinalizedPromptTokens: async () => 150_000,
      getPromptTokenBaseline: () => promptTokenBaseline,
      resetPromptTokenBaseline: () => {
        promptTokenBaseline = 0;
      },
      restorePromptTokenBaseline: (baseline) => {
        promptTokenBaseline = restoredPromptTokenBaseline(baseline);
      },
    });
    harness.deps.performCompression.mockResolvedValue(
      PerformCompressionResult.COMPRESSED,
    );
    harness.deps.performFallbackCompression.mockImplementation(
      async (_promptId, applyResult) => {
        await applyResult([makeStoredAi('resp-candidate')]);
        return true;
      },
    );
    historyService.on('tokensUpdated', () => {
      throw new Error('injected candidate installation failure');
    });
    const pending = makeUserMessage('pending request');

    await expect(
      harness.enforcer.enforce(
        {
          contents: historyService.getCuratedForProvider([pending]),
          pendingContents: [pending],
        },
        'failed-candidate',
      ),
    ).rejects.toThrow('injected candidate installation failure');

    expect(historyService.getRawHistory()).toStrictEqual(originalHistory);
    expect(historyService.getTotalTokens()).toBe(originalHistoryTokens + 37);
    expect(historyService.getBaseTokenOffset()).toBe(37);
    expect(historyService.getCacheAnchorSeq()).toBe(anchorEntry.seq);
    expect(promptTokenBaseline).toBe(123);
    expect(historyService.getRawHistory()[0].metadata).toMatchObject({
      id: 'resp-original-parent',
      responsesStored: true,
      providerMetadata: { custom: 'metadata resp-original-parent' },
    });
  });

  it('restores history state when fallback rejects after committing its candidate', async () => {
    historyService.add(makeStoredAi('resp-original-parent'));
    historyService.add(makeUserMessage('original follow-up'));
    await historyService.waitForTokenUpdates();
    historyService.setBaseTokenOffset(37);
    const [anchorEntry] = historyService.getChronologyTrace();
    historyService.setCacheAnchorSeq(anchorEntry.seq);
    const originalHistory = [...historyService.getRawHistory()];
    const originalTokens =
      (await historyService.estimateTokensForContents(originalHistory)) + 37;
    let promptTokenBaseline = 123;

    const harness = buildEnforcerHarness({
      estimateFinalizedPromptTokens: async () => 150_000,
      getPromptTokenBaseline: () => promptTokenBaseline,
      resetPromptTokenBaseline: () => {
        promptTokenBaseline = 0;
      },
      restorePromptTokenBaseline: (baseline) => {
        promptTokenBaseline = restoredPromptTokenBaseline(baseline);
      },
    });
    harness.deps.performCompression.mockResolvedValue(
      PerformCompressionResult.COMPRESSED,
    );
    harness.deps.performFallbackCompression.mockImplementation(
      async (_promptId, applyResult) => {
        await applyResult([makeStoredAi('resp-candidate')]);
        throw new Error('fallback bookkeeping failed');
      },
    );
    const pending = makeUserMessage('pending request');

    await expect(
      harness.enforcer.enforce(
        {
          contents: historyService.getCuratedForProvider([pending]),
          pendingContents: [pending],
        },
        'rejected-after-commit',
      ),
    ).rejects.toThrow('fallback bookkeeping failed');

    expect(historyService.getRawHistory()).toStrictEqual(originalHistory);
    expect(historyService.getTotalTokens()).toBe(originalTokens);
    expect(historyService.getBaseTokenOffset()).toBe(37);
    expect(historyService.getCacheAnchorSeq()).toBe(anchorEntry.seq);
    expect(promptTokenBaseline).toBe(123);
  });

  it('restores history state when prompt-baseline reset fails after replacement', async () => {
    historyService.add(makeStoredAi('resp-original-parent'));
    historyService.add(makeUserMessage('original follow-up'));
    await historyService.waitForTokenUpdates();
    historyService.setBaseTokenOffset(37);
    const [anchorEntry] = historyService.getChronologyTrace();
    historyService.setCacheAnchorSeq(anchorEntry.seq);
    const originalHistory = [...historyService.getRawHistory()];
    const originalTokens =
      (await historyService.estimateTokensForContents(originalHistory)) + 37;
    let promptTokenBaseline = 123;

    const harness = buildEnforcerHarness({
      estimateFinalizedPromptTokens: async () => 150_000,
      getPromptTokenBaseline: () => promptTokenBaseline,
      resetPromptTokenBaseline: () => {
        promptTokenBaseline = 0;
        throw new Error('prompt baseline reset failed');
      },
      restorePromptTokenBaseline: (baseline) => {
        promptTokenBaseline = restoredPromptTokenBaseline(baseline);
      },
    });
    harness.deps.performCompression.mockResolvedValue(
      PerformCompressionResult.COMPRESSED,
    );
    harness.deps.performFallbackCompression.mockImplementation(
      async (_promptId, applyResult) => {
        await applyResult([makeStoredAi('resp-candidate')]);
        return true;
      },
    );
    const pending = makeUserMessage('pending request');

    await expect(
      harness.enforcer.enforce(
        {
          contents: historyService.getCuratedForProvider([pending]),
          pendingContents: [pending],
        },
        'failed-baseline-reset',
      ),
    ).rejects.toThrow('prompt baseline reset failed');

    expect(historyService.getRawHistory()).toStrictEqual(originalHistory);
    expect(historyService.getTotalTokens()).toBe(originalTokens);
    expect(historyService.getBaseTokenOffset()).toBe(37);
    expect(historyService.getCacheAnchorSeq()).toBe(anchorEntry.seq);
    expect(promptTokenBaseline).toBe(123);
  });

  /**
   * Post-first-compression projection failure.
   *
   * enforce() projection call sequence:
   * 1. Initial projection (enforce)
   * 2. Post-density-optimization (optimizeAndProject)
   * 3. Post-compression (projectSuccess) — ALL subsequent calls reject
   */
  it('includes stage context when projection fails after first compression', async () => {
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('pending request');
    const contents: IContent[] = historyService.getCuratedForProvider([
      pending,
    ]);
    const envelope: ProviderContentEnvelope = {
      contents,
      pendingContents: [pending],
    };

    const harness = buildEnforcerHarness();
    const estimateSpy = vi.spyOn(historyService, 'estimateTokensForContents');

    estimateSpy
      .mockResolvedValueOnce(200_000)
      .mockResolvedValueOnce(200_000)
      .mockRejectedValue(new Error('estimation infrastructure down'));

    harness.deps.performCompression.mockResolvedValue(
      PerformCompressionResult.COMPRESSED,
    );

    let thrownError: Error | undefined;
    try {
      await harness.enforcer.enforce(envelope, 'test-prompt');
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError?.message).toContain('estimation infrastructure down');
    expect(thrownError?.message).toContain('post-compression stage');
  });

  /**
   * Post-retry projection failure.
   *
   * enforce() projection call sequence:
   * 1. Initial projection
   * 2. Post-density-optimization
   * 3. Post-first-compression (reduction < 5%, triggers retry)
   * 4. Post-retry-compression — ALL subsequent calls reject
   */
  it('includes stage context when projection fails after retry compression', async () => {
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('pending request');
    const contents: IContent[] = historyService.getCuratedForProvider([
      pending,
    ]);
    const envelope: ProviderContentEnvelope = {
      contents,
      pendingContents: [pending],
    };

    const harness = buildEnforcerHarness();
    const estimateSpy = vi.spyOn(historyService, 'estimateTokensForContents');

    estimateSpy
      .mockResolvedValueOnce(200_000)
      .mockResolvedValueOnce(200_000)
      .mockResolvedValueOnce(199_000)
      .mockRejectedValue(new Error('estimation infrastructure down'));

    harness.deps.performCompression.mockResolvedValue(
      PerformCompressionResult.COMPRESSED,
    );

    let thrownError: Error | undefined;
    try {
      await harness.enforcer.enforce(envelope, 'test-prompt');
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError?.message).toContain('estimation infrastructure down');
    expect(thrownError?.message.toLowerCase()).toContain('retry');
  });

  /**
   * Post-truncation projection failure.
   *
   * enforce() projection call sequence:
   * 1. Initial projection
   * 2. Post-density-optimization
   * 3. Post-first-compression (reduction < 5%, triggers retry)
   * 4. Post-retry-compression (still over, triggers truncation)
   * 5. Post-truncation — ALL subsequent calls reject
   */
  it('includes stage context when projection fails after truncation', async () => {
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('pending request');
    const contents: IContent[] = historyService.getCuratedForProvider([
      pending,
    ]);
    const envelope: ProviderContentEnvelope = {
      contents,
      pendingContents: [pending],
    };

    const harness = buildEnforcerHarness();
    const estimateSpy = vi.spyOn(historyService, 'estimateTokensForContents');

    estimateSpy
      .mockResolvedValueOnce(200_000)
      .mockResolvedValueOnce(200_000)
      .mockResolvedValueOnce(199_000)
      .mockResolvedValueOnce(199_000)
      .mockRejectedValue(new Error('estimation infrastructure down'));

    harness.deps.performCompression.mockResolvedValue(
      PerformCompressionResult.COMPRESSED,
    );

    harness.deps.performFallbackCompression.mockImplementation(
      async (_promptId, applyResult) => {
        await applyResult([makeUserMessage('truncated history')]);
        return true;
      },
    );

    let thrownError: Error | undefined;
    try {
      await harness.enforcer.enforce(envelope, 'test-prompt');
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError?.message).toContain('estimation infrastructure down');
    expect(thrownError?.message.toLowerCase()).toContain('truncation');
  });

  /**
   * Initial projection failure should propagate with a stage label.
   */
  it('propagates initial projection error with explicit stage label', async () => {
    historyService.add(makeUserMessage('established history'));
    const contents: IContent[] = historyService.getCuratedForProvider();
    const envelope: ProviderContentEnvelope = {
      contents,
      pendingContents: undefined,
    };

    const harness = buildEnforcerHarness();
    vi.spyOn(historyService, 'estimateTokensForContents').mockRejectedValue(
      new Error('estimation infrastructure down'),
    );

    let thrownError: Error | undefined;
    try {
      await harness.enforcer.enforce(envelope, 'test-prompt');
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError?.message).toContain('estimation infrastructure down');
    expect(thrownError?.message.toLowerCase()).toContain('projection');
  });

  /**
   * Finding 4 (CodeRabbit PR #2598): Projection rejection must not be caught
   * as a compression failure.
   *
   * When the first post-compression projection rejects, the stage-aware
   * projection error must propagate directly — not be caught by the
   * compression try/catch and re-projected as a compression failure. If the
   * second estimate would succeed, enforcement must NOT proceed to truncation
   * or fallback; it must surface the original projection error.
   */
  it('throws the stage-aware projection error when post-compression projection rejects, even if a subsequent estimate would succeed (CodeRabbit PR #2598)', async () => {
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('pending request');
    const contents: IContent[] = historyService.getCuratedForProvider([
      pending,
    ]);
    const envelope: ProviderContentEnvelope = {
      contents,
      pendingContents: [pending],
    };

    const harness = buildEnforcerHarness();
    const estimateSpy = vi.spyOn(historyService, 'estimateTokensForContents');

    // 1. Initial — over-limit (succeeds)
    estimateSpy.mockResolvedValueOnce(200_000);
    // 2. Post-density — over-limit (succeeds)
    estimateSpy.mockResolvedValueOnce(200_000);
    // 3. Post-first-compression — REJECTS with a specific stage error
    estimateSpy.mockRejectedValueOnce(
      new Error('estimation infrastructure down'),
    );
    // 4+. Any subsequent call would succeed (never reached)
    estimateSpy.mockResolvedValueOnce(50_000);

    harness.deps.performCompression.mockResolvedValue(
      PerformCompressionResult.COMPRESSED,
    );

    let thrownError: Error | undefined;
    try {
      await harness.enforcer.enforce(envelope, 'test-prompt');
    } catch (error) {
      thrownError = error as Error;
    }

    // The original stage-aware projection error must propagate directly.
    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError?.message).toContain('estimation infrastructure down');
    expect(thrownError?.message.toLowerCase()).toContain('post-compression');

    // Fallback must NOT be reached — the projection error surfaced before
    // truncation.
    expect(harness.deps.performFallbackCompression).not.toHaveBeenCalled();
  });
});
