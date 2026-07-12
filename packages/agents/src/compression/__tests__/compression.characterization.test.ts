/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Compression characterization tests — pins the OBSERVABLE behavior of
 * provider-content enforcement and compression budgeting BEFORE the
 * remaining retype group migrates `GenerateContentConfig`/`Part`-shaped
 * internals to neutral types.
 *
 * Uses REAL HistoryService, REAL ConversationManager, and the REAL
 * ProviderContentEnforcer / compressionBudgeting helpers. Mocks ONLY the
 * provider boundary where a provider would normally be consulted.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P26
 * @requirement:REQ-005.5c
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  TextBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  ProviderContentEnforcer,
  type ProviderContentEnforcementDeps,
} from '../providerContentEnforcement.js';
import {
  asNumber,
  extractCompletionBudgetFromParams,
  getCompletionBudget,
  estimatePendingTokens,
} from '../compressionBudgeting.js';
import type { ProviderContentEnvelope } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';

// ---------------------------------------------------------------------------
// Logger stub — DebugLogger surface used by the enforcer
// ---------------------------------------------------------------------------

function makeLogger(): DebugLogger {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as DebugLogger;
}

// ---------------------------------------------------------------------------
// Runtime-context factory — REAL ephemerals backed by HistoryService
// ---------------------------------------------------------------------------

function buildRuntimeContext(
  historyService: HistoryService,
  overrides: {
    compressionThreshold?: number;
    contextLimit?: number;
  } = {},
): AgentRuntimeContext {
  const state = createAgentRuntimeState({
    runtimeId: 'p26-comp-test',
    provider: 'test',
    model: 'test-model',
    sessionId: 'test-session',
  });
  return createAgentRuntimeContext({
    state,
    history: historyService,
    settings: {
      compressionThreshold: overrides.compressionThreshold ?? 0.8,
      contextLimit: overrides.contextLimit ?? 131072,
      preserveThreshold: 0.2,
      telemetry: { enabled: false, target: null },
      'reasoning.includeInContext': true,
    },
    provider: {} as never,
    telemetry: {} as never,
    tools: {} as never,
    providerRuntime: {
      runtimeId: 'test-runtime',
      settingsService: { get: vi.fn(() => undefined) } as never,
      config: {} as never,
    } as never,
  });
}

// ---------------------------------------------------------------------------
// Content factories (neutral IContent / ContentBlock)
// ---------------------------------------------------------------------------

function textContent(speaker: IContent['speaker'], text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

// ---------------------------------------------------------------------------
// Enforcer harness — REAL ProviderContentEnforcer over a REAL HistoryService
// ---------------------------------------------------------------------------

interface EnforcerHarness {
  enforcer: ProviderContentEnforcer;
  deps: ProviderContentEnforcementDeps;
  historyService: HistoryService;
  runtimeContext: AgentRuntimeContext;
  performCompression: ReturnType<typeof vi.fn>;
  performFallbackCompression: ReturnType<typeof vi.fn>;
  ensureDensityOptimized: ReturnType<typeof vi.fn>;
}

function buildEnforcerHarness(
  overrides: {
    compressionThreshold?: number;
    contextLimit?: number;
    generationConfig?: Record<string, unknown>;
    performCompressionResult?: PerformCompressionResult;
  } = {},
): EnforcerHarness {
  const historyService = new HistoryService();
  const runtimeContext = buildRuntimeContext(historyService, {
    compressionThreshold: overrides.compressionThreshold,
    contextLimit: overrides.contextLimit,
  });
  const performCompression = vi
    .fn()
    .mockResolvedValue(
      overrides.performCompressionResult ?? PerformCompressionResult.COMPRESSED,
    );
  const performFallbackCompression = vi.fn().mockResolvedValue(false);
  const ensureDensityOptimized = vi.fn().mockResolvedValue(undefined);
  const deps: ProviderContentEnforcementDeps = {
    historyService,
    runtimeContext,
    generationConfig: overrides.generationConfig ?? {},
    providerRuntimeNullable: undefined,
    logger: makeLogger(),
    ensureDensityOptimized,
    performCompression,
    performFallbackCompression,
  };
  return {
    enforcer: new ProviderContentEnforcer(deps),
    deps,
    historyService,
    runtimeContext,
    performCompression,
    performFallbackCompression,
    ensureDensityOptimized,
  };
}

/**
 * Builds an envelope whose `contents` carry a deterministic token estimate
 * (driven by `estimateTokensForContents` on the HistoryService). The test
 * spies on that method to control the projection.
 */
function buildEnvelope(
  contents: IContent[],
  pendingContents?: IContent[],
): ProviderContentEnvelope {
  return {
    contents,
    ...(pendingContents !== undefined ? { pendingContents } : {}),
  } as ProviderContentEnvelope;
}

// ---------------------------------------------------------------------------
// REQ-005.5c — providerContentEnforcement observable behavior
// ---------------------------------------------------------------------------

describe('P26: providerContentEnforcement characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the original contents unchanged when projected tokens are under the compression threshold', async () => {
    const harness = buildEnforcerHarness();
    const contents: IContent[] = [
      textContent('human', 'small prompt'),
      textContent('ai', 'small answer'),
    ];
    // Force the token estimate well below the threshold.
    vi.spyOn(
      harness.historyService,
      'estimateTokensForContents',
    ).mockResolvedValue(100);
    vi.spyOn(harness.historyService, 'waitForTokenUpdates').mockResolvedValue(
      undefined,
    );

    const result = await harness.enforcer.enforce(
      buildEnvelope(contents, contents),
      'prompt-p26-1',
    );
    expect(result).toBe(contents);
    expect(harness.performCompression).not.toHaveBeenCalled();
  });

  it('triggers compression when projected tokens exceed the compression threshold', async () => {
    // Use a tiny completion budget so the compression threshold is dominated
    // by the token estimate rather than the default 65_536 budget.
    const harness = buildEnforcerHarness({
      compressionThreshold: 0.1,
      contextLimit: 100000,
      generationConfig: { maxOutputTokens: 100 },
    });
    const contents: IContent[] = [
      textContent('human', 'prompt that pushes us over'),
      textContent('ai', 'answer'),
    ];
    // Project way over the threshold but under the hard limit so compression
    // fires and the recomposed result fits.
    const estimateSpy = vi
      .spyOn(harness.historyService, 'estimateTokensForContents')
      .mockResolvedValue(20000);
    vi.spyOn(harness.historyService, 'waitForTokenUpdates').mockResolvedValue(
      undefined,
    );
    vi.spyOn(harness.historyService, 'getCurated').mockReturnValue(contents);

    await harness.enforcer.enforce(
      buildEnvelope(contents, contents),
      'prompt-p26-2',
    );
    expect(harness.performCompression).toHaveBeenCalledTimes(1);
    expect(harness.performCompression).toHaveBeenCalledWith('prompt-p26-2', {
      bypassCooldown: true,
      trigger: 'auto',
    });
    estimateSpy.mockRestore();
  });

  it('returns recomposed pending contents after compression brings the projection under the limit', async () => {
    const harness = buildEnforcerHarness({
      compressionThreshold: 0.1,
      contextLimit: 100000,
      generationConfig: { maxOutputTokens: 100 },
    });
    const pendingContents: IContent[] = [
      textContent('human', 'pending user prompt'),
      textContent('ai', 'pending ai text'),
    ];
    const curatedAfterCompression: IContent[] = [
      textContent('human', 'compressed summary'),
    ];
    const estimateSpy = vi
      .spyOn(harness.historyService, 'estimateTokensForContents')
      .mockResolvedValue(100);
    vi.spyOn(harness.historyService, 'waitForTokenUpdates').mockResolvedValue(
      undefined,
    );
    vi.spyOn(harness.historyService, 'getCurated').mockReturnValue(
      curatedAfterCompression,
    );

    const result = await harness.enforcer.enforce(
      buildEnvelope(pendingContents, pendingContents),
      'prompt-p26-3',
    );
    // After compression the projection (100 + completionBudget) must be under
    // the safety-adjusted limit; the enforcer recomposes pending onto curated.
    // Assert OBSERVABLE text content — the exact array shape is subject to
    // provider-content normalization (dedupe/adjacency), which is itself
    // behavior pinned elsewhere.
    const allText = result
      .flatMap((c) => c.blocks)
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    expect(allText).toContain('pending user prompt');
    expect(allText).toContain('pending ai text');
    estimateSpy.mockRestore();
  });

  it('throws a context-overflow error when compression + fallback cannot bring the projection under the hard limit', async () => {
    const harness = buildEnforcerHarness({
      compressionThreshold: 0.1,
      contextLimit: 1000,
      performCompressionResult: PerformCompressionResult.FAILED,
    });
    // Make the fallback fail too.
    harness.performFallbackCompression.mockResolvedValue(false);
    const contents: IContent[] = [
      textContent('human', 'prompt'),
      textContent('ai', 'answer'),
    ];
    // Always project over the hard limit.
    vi.spyOn(
      harness.historyService,
      'estimateTokensForContents',
    ).mockResolvedValue(10_000_000);
    vi.spyOn(harness.historyService, 'waitForTokenUpdates').mockResolvedValue(
      undefined,
    );
    vi.spyOn(harness.historyService, 'getCurated').mockReturnValue(contents);

    await expect(
      harness.enforcer.enforce(
        buildEnvelope(contents, contents),
        'prompt-p26-overflow',
      ),
    ).rejects.toThrow(/context limit/i);
  });

  it('throws an unrecoverable-boundary error when pendingContents is undefined and the projection is over the hard limit', async () => {
    const harness = buildEnforcerHarness({
      compressionThreshold: 0.1,
      contextLimit: 1000,
    });
    const contents: IContent[] = [textContent('human', 'prompt')];
    vi.spyOn(
      harness.historyService,
      'estimateTokensForContents',
    ).mockResolvedValue(10_000_000);
    vi.spyOn(harness.historyService, 'waitForTokenUpdates').mockResolvedValue(
      undefined,
    );

    await expect(
      harness.enforcer.enforce(
        buildEnvelope(contents, undefined),
        'prompt-p26-noboundary',
      ),
    ).rejects.toThrow(/unrecoverable/i);
  });

  it('returns original contents when pendingContents is undefined but the projection is under the hard limit', async () => {
    const harness = buildEnforcerHarness();
    const contents: IContent[] = [textContent('human', 'small')];
    // Over the compression threshold but UNDER the hard limit.
    vi.spyOn(
      harness.historyService,
      'estimateTokensForContents',
    ).mockResolvedValue(100);
    vi.spyOn(harness.historyService, 'waitForTokenUpdates').mockResolvedValue(
      undefined,
    );

    const result = await harness.enforcer.enforce(
      buildEnvelope(contents, undefined),
      'prompt-p26-under-hard',
    );
    expect(result).toBe(contents);
  });

  // PROPERTY: for ANY token estimate under the compression threshold, the
  // original contents are returned untouched and compression never fires.
  it('never compresses when the projected token estimate is under the threshold (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 100 }),
        async (smallEstimate: number) => {
          const harness = buildEnforcerHarness();
          const contents: IContent[] = [
            textContent('human', 'q'),
            textContent('ai', 'a'),
          ];
          vi.spyOn(
            harness.historyService,
            'estimateTokensForContents',
          ).mockResolvedValue(smallEstimate);
          vi.spyOn(
            harness.historyService,
            'waitForTokenUpdates',
          ).mockResolvedValue(undefined);

          const result = await harness.enforcer.enforce(
            buildEnvelope(contents, contents),
            'prompt-prop-1',
          );
          expect(result).toBe(contents);
          expect(harness.performCompression).not.toHaveBeenCalled();
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// REQ-005.5c — compressionBudgeting observable behavior
// ---------------------------------------------------------------------------

describe('P26: compressionBudgeting characterization', () => {
  it('asNumber extracts a finite number from a numeric value', () => {
    expect(asNumber(42)).toBe(42);
  });

  it('asNumber extracts a number from a numeric string', () => {
    expect(asNumber('128')).toBe(128);
  });

  it('asNumber returns undefined for non-numeric input', () => {
    expect(asNumber('not-a-number')).toBeUndefined();
    expect(asNumber(null)).toBeUndefined();
    expect(asNumber(undefined)).toBeUndefined();
    expect(asNumber(NaN)).toBeUndefined();
    expect(asNumber(Infinity)).toBeUndefined();
  });

  it('extractCompletionBudgetFromParams reads maxOutputTokens', () => {
    expect(extractCompletionBudgetFromParams({ maxOutputTokens: 4096 })).toBe(
      4096,
    );
  });

  it('extractCompletionBudgetFromParams reads maxTokens as a fallback', () => {
    expect(extractCompletionBudgetFromParams({ maxTokens: 2048 })).toBe(2048);
  });

  it('extractCompletionBudgetFromParams reads snake_case keys', () => {
    expect(extractCompletionBudgetFromParams({ max_output_tokens: 1024 })).toBe(
      1024,
    );
    expect(extractCompletionBudgetFromParams({ max_tokens: 512 })).toBe(512);
  });

  it('extractCompletionBudgetFromParams returns undefined when no candidate key is present', () => {
    expect(extractCompletionBudgetFromParams({})).toBeUndefined();
    expect(extractCompletionBudgetFromParams(undefined)).toBeUndefined();
  });

  it('getCompletionBudget prefers generationConfig.maxOutputTokens over provider params and default', () => {
    const cfg = { maxOutputTokens: 8192 } as Record<string, unknown>;
    expect(getCompletionBudget(cfg as never, 'm')).toBe(8192);
  });

  it('getCompletionBudget falls back to provider getModelParams when generationConfig has no budget', () => {
    const provider = {
      getModelParams: () => ({ maxTokens: 4096 }),
    } as unknown as IProvider;
    expect(getCompletionBudget({}, 'm', provider)).toBe(4096);
  });

  it('getCompletionBudget falls back to the default (65536) when nothing is set', () => {
    expect(getCompletionBudget({}, 'm')).toBe(65_536);
  });

  it('getCompletionBudget prefers the live settingsService maxOutputTokens over all other sources', () => {
    const settingsService = {
      get: (key: string) => (key === 'maxOutputTokens' ? 32768 : undefined),
    };
    const cfg = { maxOutputTokens: 8192 } as Record<string, unknown>;
    expect(
      getCompletionBudget(cfg as never, 'm', undefined, settingsService),
    ).toBe(32768);
  });

  it('estimatePendingTokens returns 0 for empty contents', async () => {
    const historyService = new HistoryService();
    const estimate = await estimatePendingTokens([], historyService, 'm');
    expect(estimate).toBe(0);
  });

  it('estimatePendingTokens delegates to historyService.estimateTokensForContents for non-empty input', async () => {
    const historyService = new HistoryService();
    const spy = vi
      .spyOn(historyService, 'estimateTokensForContents')
      .mockResolvedValue(777);
    const contents: IContent[] = [textContent('human', 'hi')];
    const estimate = await estimatePendingTokens(contents, historyService, 'm');
    expect(estimate).toBe(777);
    expect(spy).toHaveBeenCalledWith(contents, 'm');
  });

  // PROPERTY: asNumber round-trips any finite number
  it('asNumber round-trips any finite number (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100000, max: 100000 }), (n: number) => {
        expect(asNumber(n)).toBe(n);
      }),
    );
  });

  // PROPERTY: extractCompletionBudgetFromParams resolves the FIRST candidate
  // key that carries a finite number, for any ordering of the candidate set.
  it('extractCompletionBudgetFromParams resolves the first finite candidate (property)', () => {
    const keyArb = fc.constantFrom(
      'maxOutputTokens',
      'maxTokens',
      'max_output_tokens',
      'max_tokens',
    );
    const valueArb = fc.integer({ min: 1, max: 100000 });
    fc.assert(
      fc.property(keyArb, valueArb, (key: string, value: number) => {
        const params: Record<string, unknown> = { [key]: value };
        expect(extractCompletionBudgetFromParams(params)).toBe(value);
      }),
    );
  });

  // PROPERTY: estimatePendingTokens is always 0 for an empty contents array
  // regardless of the HistoryService state.
  it('estimatePendingTokens is always 0 for empty contents (property)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (model: string) => {
        const historyService = new HistoryService();
        const estimate = await estimatePendingTokens([], historyService, model);
        expect(estimate).toBe(0);
      }),
    );
  });
});
