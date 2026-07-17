/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License: Apache-2.0
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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

vi.mock('@vybestack/llxprt-code-settings', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@vybestack/llxprt-code-settings')>();
  return {
    ...original,
    Storage: {
      ...original.Storage,
      getGlobalConfigDir: vi.fn(() => '/tmp/llxprt-test-config'),
    },
  };
});

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
    });

    handler = new CompressionHandler(
      runtimeContext,
      historyService,
      {},
      vi.fn().mockResolvedValue({
        provider: {
          name: 'test',
          generateChatCompletion: vi.fn(),
        } as never,
      }),
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

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockReturnValue({
      name: 'top-down-truncation',
      requiresLLM: false,
      trigger: { mode: 'threshold', defaultThreshold: 0.8 },
      compress: vi
        .fn()
        .mockRejectedValue(new Error('truncation engine blew up')),
    } as never);

    let thrownError: Error | undefined;
    try {
      await handler.enforceProviderContents(envelope, 'test-prompt');
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError!.message).toContain(
      'Truncation fallback failed during hard-limit enforcement',
    );
    expect(thrownError!.message).toContain('truncation engine blew up');
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
    expect(thrownError!.message).toContain(
      'Truncation fallback failed during hard-limit enforcement',
    );
    expect(thrownError!.message).toContain('context build exploded');
  });

  /**
   * When the fallback strategy succeeds, the normal happy path should work
   * (no regression).
   */
  it('still succeeds when fallback truncation works correctly', async () => {
    historyService.add(makeUserMessage('established history'));

    const pending = makeUserMessage('pending request');
    const envelope: ProviderContentEnvelope = {
      contents: historyService.getCuratedForProvider([pending]),
      pendingContents: [pending],
    };

    const estimateSpy = vi
      .spyOn(historyService, 'estimateTokensForContents')
      .mockResolvedValue(150_000);

    vi.spyOn(handler, 'performCompression').mockResolvedValue(
      PerformCompressionResult.COMPRESSED,
    );

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockReturnValue({
      name: 'top-down-truncation',
      requiresLLM: false,
      trigger: { mode: 'threshold', defaultThreshold: 0.8 },
      compress: vi.fn().mockResolvedValue({
        newHistory: [makeUserMessage('truncated summary')],
        strategy: 'top-down-truncation',
        summary: undefined,
      }),
    } as never);

    estimateSpy.mockResolvedValue(50_000);

    const result = await handler.enforceProviderContents(
      envelope,
      'test-prompt',
    );

    expect(result).toContainEqual(pending);
  });
});

// ---------------------------------------------------------------------------
// Finding 2: Stage-aware projection errors in ProviderContentEnforcer
// ---------------------------------------------------------------------------

describe('Finding 2: stage-aware projection errors in ProviderContentEnforcer (Issue #2588)', () => {
  let historyService: HistoryService;
  let runtimeContext: AgentRuntimeContext;

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
    runtimeContext = buildRuntimeContext(historyService, {
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
      ...overrides,
    };
    return { enforcer: new ProviderContentEnforcer(deps), deps };
  }

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
    expect(thrownError!.message).toContain('estimation infrastructure down');
    expect(thrownError!.message.toLowerCase()).toContain('compression');
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
    expect(thrownError!.message).toContain('estimation infrastructure down');
    expect(thrownError!.message.toLowerCase()).toContain('retry');
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
        applyResult([makeUserMessage('truncated history')]);
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
    expect(thrownError!.message).toContain('estimation infrastructure down');
    expect(thrownError!.message.toLowerCase()).toContain('truncation');
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
    expect(thrownError!.message).toContain('estimation infrastructure down');
    expect(thrownError!.message.toLowerCase()).toContain('projection');
  });
});
