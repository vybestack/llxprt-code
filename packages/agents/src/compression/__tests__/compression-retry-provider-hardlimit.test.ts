/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ProviderContentEnforcer hard-limit enforcement retry
 * policy (Issue #2588).
 *
 * The provider-content enforcement path must use the SAME margin policy and
 * one-retry-before-truncation retry policy as the pending enforcement path
 * (Issue #2067). Previously the provider path had its own divergent margin
 * calculation (missing the 0.5% cushion) and skipped the retry attempt,
 * causing needless compression at the near-limit boundary and premature
 * truncation.
 *
 * These tests follow dev-docs/RULES.md: their primary assertions cover
 * observable behavior (returned provider contents, error messages, pending
 * preservation). Call-state assertions additionally pin whether retry and
 * fallback boundaries were reached. The ProviderContentEnforcer and
 * HistoryService are real; only infrastructure boundaries (token estimation,
 * compression execution) are mocked.
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
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';

const ISSUE_CONTEXT_LIMIT = 262_144;
const STANDARD_CONTEXT_LIMIT = 200_000;
const COMPRESSION_THRESHOLD = 0.8;

function makeLogger(): DebugLogger {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as DebugLogger;
}

interface EnforcerHarness {
  enforcer: ProviderContentEnforcer;
  deps: ProviderContentEnforcementDeps;
  historyService: HistoryService;
  runtimeContext: AgentRuntimeContext;
}

function buildEnforcerHarness(
  historyService: HistoryService,
  runtimeContext: AgentRuntimeContext,
  overrides: Partial<ProviderContentEnforcementDeps> = {},
): EnforcerHarness {
  const performCompression = vi.fn();
  const performFallbackCompression = vi.fn().mockResolvedValue(false);
  const ensureDensityOptimized = vi.fn().mockResolvedValue(undefined);
  const deps: ProviderContentEnforcementDeps = {
    historyService,
    runtimeContext,
    generationConfig: {},
    providerRuntimeNullable: undefined,
    logger: makeLogger(),
    ensureDensityOptimized,
    performCompression,
    performFallbackCompression,
    ...overrides,
  };
  return {
    enforcer: new ProviderContentEnforcer(deps),
    deps,
    historyService,
    runtimeContext,
  };
}

describe('ProviderContentEnforcer hard-limit retry policy (Issue #2588)', () => {
  let historyService: HistoryService;
  let runtimeContext: AgentRuntimeContext;

  beforeEach(() => {
    vi.clearAllMocks();
    historyService = new HistoryService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Test A: Near-limit shape returns original contents (no needless compression)
  // -----------------------------------------------------------------------
  describe('near-limit 0.5% capped cushion', () => {
    it('returns contents without overflow error for the exact issue-2588 near-limit shape', async () => {
      // Exact scenario from the issue:
      //   context limit   = 262144
      //   completionBudget = 65536
      //   projected        = 261346
      //   old safety-adjusted limit (no cushion) = 262144 - 1000 = 261144
      //   tokensStillNeeded with old code = 261346 - 261144 = 202
      //
      // With the shared 0.5% cushion policy (same as pending #2067):
      //   safetyAdjusted = 262144 - 1000 = 261144
      //   cushion         = floor(261144 * 0.005) = 1305
      //   marginAdjusted  = min(262144, 261144 + 1305) = 262144
      //   projected 261346 <= 262144 → no overflow, no needless error
      //
      // The projected IS over the compression threshold (222822) so compression
      // is triggered, but even with zero reduction the capped margin keeps the
      // payload under the hard limit — no overflow error is thrown.
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: ISSUE_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const pending = makeUserMessage('pending request');
      const contents = historyService.getCuratedForProvider([pending]);

      const harness = buildEnforcerHarness(historyService, runtimeContext);
      // estimate = projected - completionBudget = 261346 - 65536 = 195810
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        195_810,
      );

      // Compression does zero reduction (simulating the issue scenario)
      harness.deps.performCompression.mockImplementation(
        async () => PerformCompressionResult.COMPRESSED,
      );

      const result = await harness.enforcer.enforce(
        { contents, pendingContents: [pending] },
        'test-prompt',
      );

      // No overflow error thrown — the capped cushion prevents the needless
      // error that the user saw in the issue (tokensStillNeeded=202, reduced 0)
      expect(result).toContainEqual(pending);
      expect(harness.deps.performCompression).toHaveBeenCalledOnce();
    });

    it('still triggers compression when projected exceeds the capped cushion limit', async () => {
      // projected = 263000 > 262144 (capped limit) → compression needed
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: ISSUE_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const pending = makeUserMessage('pending request');
      const contents = historyService.getCuratedForProvider([pending]);

      const harness = buildEnforcerHarness(historyService, runtimeContext);
      const estimateSpy = vi
        .spyOn(historyService, 'estimateTokensForContents')
        .mockResolvedValue(197_464); // 197464 + 65536 = 263000 > 262144

      harness.deps.performCompression.mockImplementation(async () => {
        historyService.clear();
        historyService.add(makeUserMessage('compressed summary'));
        estimateSpy.mockResolvedValue(1_000);
        return PerformCompressionResult.COMPRESSED;
      });

      const result = await harness.enforcer.enforce(
        { contents, pendingContents: [pending] },
        'test-prompt',
      );

      expect(result).not.toStrictEqual(contents);
      expect(result).toContainEqual(pending);
    });
  });

  // -----------------------------------------------------------------------
  // Test B: First compression ineffective, second compression fits
  // -----------------------------------------------------------------------
  describe('one-retry-before-truncation: ineffective first compression', () => {
    it('makes exactly one additional full compression attempt when first compression is ineffective (<5%) and second fits', async () => {
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: STANDARD_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const pending = makeUserMessage('pending request');
      const contents = historyService.getCuratedForProvider([pending]);

      const harness = buildEnforcerHarness(historyService, runtimeContext);
      // marginAdjustedLimit with 0.5% cushion:
      //   safetyAdjusted = 199000
      //   cushion = floor(199000 * 0.005) = 995
      //   marginAdjusted = min(200000, 199995) = 199995
      // First estimate: 150000 + 65536 = 215536 > 199995
      // After 1st compression: 148000 + 65536 = 213536 (reduction <5%, ineffective)
      // After 2nd compression: 100000 + 65536 = 165536 < 199995 → fits!
      const estimateSpy = vi
        .spyOn(historyService, 'estimateTokensForContents')
        .mockResolvedValue(150_000);

      let compressionCallCount = 0;
      harness.deps.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        historyService.clear();
        if (compressionCallCount === 1) {
          historyService.add(makeUserMessage('first compressed summary'));
          estimateSpy.mockResolvedValue(148_000); // <5% reduction, still over
        } else {
          historyService.add(makeUserMessage('second compressed summary'));
          estimateSpy.mockResolvedValue(100_000); // fits now
        }
        return PerformCompressionResult.COMPRESSED;
      });

      const result = await harness.enforcer.enforce(
        { contents, pendingContents: [pending] },
        'test-prompt',
      );

      // Two full compression attempts were made (not truncation)
      expect(compressionCallCount).toBe(2);

      // Result contains the SECOND summary, not the first, and not a fallback
      const allText = result
        .flatMap((c) => c.blocks)
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join(' ');
      expect(allText).toContain('second compressed summary');
      expect(allText).not.toContain('first compressed summary');

      // Pending is preserved
      expect(result).toContainEqual(pending);

      // Truncation was NOT invoked
      expect(harness.deps.performFallbackCompression).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Test C: Retry insufficient, truncation fits
  // -----------------------------------------------------------------------
  describe('retry remains insufficient, truncation fits', () => {
    it('falls through to truncation when both compression attempts remain over limit, and preserves pending', async () => {
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: STANDARD_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const pending = makeUserMessage('pending request');
      const contents = historyService.getCuratedForProvider([pending]);

      const harness = buildEnforcerHarness(historyService, runtimeContext);
      const estimateSpy = vi
        .spyOn(historyService, 'estimateTokensForContents')
        .mockResolvedValue(150_000);

      let compressionCallCount = 0;
      harness.deps.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        historyService.clear();
        historyService.add(makeUserMessage('compressed still large'));
        // Both compressions remain over limit
        estimateSpy.mockResolvedValue(148_000);
        return PerformCompressionResult.COMPRESSED;
      });

      // Truncation fits
      harness.deps.performFallbackCompression.mockImplementation(
        async (_promptId, applyResult) => {
          estimateSpy.mockResolvedValue(50_000); // fits
          applyResult([makeUserMessage('truncated history')]);
          return true;
        },
      );

      const result = await harness.enforcer.enforce(
        { contents, pendingContents: [pending] },
        'test-prompt',
      );

      // Two compression attempts were made, then truncation
      expect(compressionCallCount).toBe(2);
      expect(harness.deps.performFallbackCompression).toHaveBeenCalled();

      // Result contains truncated history and pending is preserved
      const allText = result
        .flatMap((c) => c.blocks)
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join(' ');
      expect(allText).toContain('truncated history');
      expect(result).toContainEqual(pending);
    });
  });

  // -----------------------------------------------------------------------
  // Test D: Diagnostics for compression/truncation failures
  // -----------------------------------------------------------------------
  describe('failure diagnostics', () => {
    it('does not redundantly retry full compression when first compression FAILED, proceeds to truncation', async () => {
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: STANDARD_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const pending = makeUserMessage('pending request');
      const contents = historyService.getCuratedForProvider([pending]);

      const harness = buildEnforcerHarness(historyService, runtimeContext);
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        150_000,
      );

      let compressionCallCount = 0;
      harness.deps.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        historyService.clear();
        historyService.add(makeUserMessage('attempted compression'));
        // First compression FAILED (non-throwing)
        return PerformCompressionResult.FAILED;
      });

      // Truncation also fails to bring it under limit
      harness.deps.performFallbackCompression.mockResolvedValue(false);

      let thrownError: Error | undefined;
      try {
        await harness.enforcer.enforce(
          { contents, pendingContents: [pending] },
          'test-prompt',
        );
      } catch (error) {
        thrownError = error as Error;
      }

      // Only ONE compression attempt (no redundant retry on FAILED)
      expect(compressionCallCount).toBe(1);
      expect(harness.deps.performFallbackCompression).toHaveBeenCalled();

      expect(thrownError).toBeInstanceOf(Error);
      expect(thrownError!.message).toContain(
        'Automatic compression failed before fallback',
      );
    });

    it('does not redundantly retry full compression when first compression THREW, proceeds to truncation', async () => {
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: STANDARD_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const pending = makeUserMessage('pending request');
      const contents = historyService.getCuratedForProvider([pending]);

      const harness = buildEnforcerHarness(historyService, runtimeContext);
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        150_000,
      );

      let compressionCallCount = 0;
      harness.deps.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        throw new Error('network error during compression');
      });

      // Truncation also fails
      harness.deps.performFallbackCompression.mockResolvedValue(false);

      let thrownError: Error | undefined;
      try {
        await harness.enforcer.enforce(
          { contents, pendingContents: [pending] },
          'test-prompt',
        );
      } catch (error) {
        thrownError = error as Error;
      }

      // Only ONE compression attempt (no redundant retry on thrown error)
      expect(compressionCallCount).toBe(1);
      expect(harness.deps.performFallbackCompression).toHaveBeenCalled();

      expect(thrownError).toBeInstanceOf(Error);
      expect(thrownError!.message).toContain(
        'Automatic compression failed before fallback',
      );
      expect(thrownError!.message).toContain(
        'network error during compression',
      );
    });

    it('proceeds to truncation when the retry compression attempt fails, and includes compression failure diagnostics', async () => {
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: STANDARD_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const pending = makeUserMessage('pending request');
      const contents = historyService.getCuratedForProvider([pending]);

      const harness = buildEnforcerHarness(historyService, runtimeContext);
      const estimateSpy = vi
        .spyOn(historyService, 'estimateTokensForContents')
        .mockResolvedValue(150_000);

      let compressionCallCount = 0;
      harness.deps.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        historyService.clear();
        if (compressionCallCount === 1) {
          // First compression succeeds but is ineffective
          historyService.add(makeUserMessage('ineffective compression'));
          estimateSpy.mockResolvedValue(148_000);
          return PerformCompressionResult.COMPRESSED;
        }
        // Second (retry) compression fails
        throw new Error('retry compression failed');
      });

      // Truncation also fails
      harness.deps.performFallbackCompression.mockResolvedValue(false);

      let thrownError: Error | undefined;
      try {
        await harness.enforcer.enforce(
          { contents, pendingContents: [pending] },
          'test-prompt',
        );
      } catch (error) {
        thrownError = error as Error;
      }

      // Two compression attempts (first succeeded, retry failed)
      expect(compressionCallCount).toBe(2);
      expect(harness.deps.performFallbackCompression).toHaveBeenCalled();

      expect(thrownError).toBeInstanceOf(Error);
      // Compression failure diagnostics surfaced
      expect(thrownError!.message).toContain(
        'Automatic compression failed before fallback',
      );
      expect(thrownError!.message).toContain(
        'Additional hard-limit compression attempt failed',
      );
    });

    it('includes truncation failure details when truncation also fails', async () => {
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: STANDARD_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const pending = makeUserMessage('pending request');
      const contents = historyService.getCuratedForProvider([pending]);

      const harness = buildEnforcerHarness(historyService, runtimeContext);
      const estimateSpy = vi
        .spyOn(historyService, 'estimateTokensForContents')
        .mockResolvedValue(150_000);

      harness.deps.performCompression.mockImplementation(async () => {
        historyService.clear();
        historyService.add(makeUserMessage('ineffective compression'));
        estimateSpy.mockResolvedValue(148_000);
        return PerformCompressionResult.COMPRESSED;
      });

      // Truncation rejects (throws)
      harness.deps.performFallbackCompression.mockRejectedValue(
        new Error('truncation broke'),
      );

      let thrownError: Error | undefined;
      try {
        await harness.enforcer.enforce(
          { contents, pendingContents: [pending] },
          'test-prompt',
        );
      } catch (error) {
        thrownError = error as Error;
      }

      expect(thrownError).toBeInstanceOf(Error);
      expect(thrownError!.message).toContain(
        'Truncation fallback failed during hard-limit enforcement',
      );
      expect(thrownError!.message).toContain('truncation broke');
    });
  });

  // -----------------------------------------------------------------------
  // Test E: Unrecoverable boundary regression + pending preservation
  // -----------------------------------------------------------------------
  describe('unrecoverable boundary preservation (issues #2304/#2306)', () => {
    it('returns contents as-is when pendingContents is undefined but under capped hard limit', async () => {
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: ISSUE_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const contents = historyService.getCuratedForProvider();

      const harness = buildEnforcerHarness(historyService, runtimeContext);
      // projected = 195810 + 65536 = 261346 <= 262144 (capped limit) → as-is
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        195_810,
      );

      const result = await harness.enforcer.enforce(
        { contents, pendingContents: undefined },
        'test-prompt',
      );

      expect(result).toStrictEqual(contents);
    });

    it('throws unrecoverable-boundary error when pendingContents is undefined and over capped hard limit', async () => {
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: ISSUE_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const contents = historyService.getCuratedForProvider();

      const harness = buildEnforcerHarness(historyService, runtimeContext);
      // projected = 300000 + 65536 = 365536 > 262144 → unrecoverable
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        300_000,
      );

      await expect(
        harness.enforcer.enforce(
          { contents, pendingContents: undefined },
          'test-prompt',
        ),
      ).rejects.toThrow(/unrecoverable/i);
    });
  });

  // -----------------------------------------------------------------------
  // Test F: Non-COMPRESSED (skipped) outcomes are treated as ineffective
  // consistently — no redundant retry, proceeds to truncation, diagnostics
  // identify the skipped result.
  // -----------------------------------------------------------------------
  describe('non-COMPRESSED skipped results (SKIPPED_EMPTY / SKIPPED_COOLDOWN)', () => {
    it('does not make an additional full retry when first compression returns SKIPPED_EMPTY, proceeds to truncation', async () => {
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: STANDARD_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const pending = makeUserMessage('pending request');
      const contents = historyService.getCuratedForProvider([pending]);

      const harness = buildEnforcerHarness(historyService, runtimeContext);
      const estimateSpy = vi
        .spyOn(historyService, 'estimateTokensForContents')
        .mockResolvedValue(150_000);

      let compressionCallCount = 0;
      harness.deps.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        // First compression returns a skipped result, not FAILED.
        return PerformCompressionResult.SKIPPED_EMPTY;
      });

      // Truncation fits so we observe the final return value.
      harness.deps.performFallbackCompression.mockImplementation(
        async (_promptId, applyResult) => {
          estimateSpy.mockResolvedValue(50_000);
          applyResult([makeUserMessage('truncated history')]);
          return true;
        },
      );

      const result = await harness.enforcer.enforce(
        { contents, pendingContents: [pending] },
        'test-prompt',
      );

      // Only ONE compression attempt — a skipped result must NOT trigger a
      // redundant full retry (treating it as "successful" like COMPRESSED).
      expect(compressionCallCount).toBe(1);

      // Truncation was reached.
      expect(harness.deps.performFallbackCompression).toHaveBeenCalled();
      expect(result).toContainEqual(pending);
    });

    it('does not make an additional full retry when first compression returns SKIPPED_COOLDOWN, proceeds to truncation', async () => {
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: STANDARD_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const pending = makeUserMessage('pending request');
      const contents = historyService.getCuratedForProvider([pending]);

      const harness = buildEnforcerHarness(historyService, runtimeContext);
      const estimateSpy = vi
        .spyOn(historyService, 'estimateTokensForContents')
        .mockResolvedValue(150_000);

      let compressionCallCount = 0;
      harness.deps.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        return PerformCompressionResult.SKIPPED_COOLDOWN;
      });

      harness.deps.performFallbackCompression.mockImplementation(
        async (_promptId, applyResult) => {
          estimateSpy.mockResolvedValue(50_000);
          applyResult([makeUserMessage('truncated history')]);
          return true;
        },
      );

      const result = await harness.enforcer.enforce(
        { contents, pendingContents: [pending] },
        'test-prompt',
      );

      expect(compressionCallCount).toBe(1);
      expect(harness.deps.performFallbackCompression).toHaveBeenCalled();
      expect(result).toContainEqual(pending);
    });

    it('retains actionable diagnostics identifying the skipped result when overflow remains after truncation', async () => {
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: STANDARD_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const pending = makeUserMessage('pending request');
      const contents = historyService.getCuratedForProvider([pending]);

      const harness = buildEnforcerHarness(historyService, runtimeContext);
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        150_000,
      );

      let compressionCallCount = 0;
      harness.deps.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        return PerformCompressionResult.SKIPPED_EMPTY;
      });

      // Truncation does NOT bring it under limit → overflow error.
      harness.deps.performFallbackCompression.mockResolvedValue(false);

      let thrownError: Error | undefined;
      try {
        await harness.enforcer.enforce(
          { contents, pendingContents: [pending] },
          'test-prompt',
        );
      } catch (error) {
        thrownError = error as Error;
      }

      expect(compressionCallCount).toBe(1);
      expect(thrownError).toBeInstanceOf(Error);
      // The diagnostics should identify the skipped compression result so the
      // error is actionable.
      expect(thrownError!.message).toContain('skipped_empty');
    });
  });

  // -----------------------------------------------------------------------
  // Test G: Additional compression retry failure preserves the underlying cause
  // -----------------------------------------------------------------------
  describe('retry-failure cause preservation', () => {
    it('preserves the underlying retry error message in final diagnostics (not just generic message)', async () => {
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: STANDARD_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const pending = makeUserMessage('pending request');
      const contents = historyService.getCuratedForProvider([pending]);

      const harness = buildEnforcerHarness(historyService, runtimeContext);
      const estimateSpy = vi
        .spyOn(historyService, 'estimateTokensForContents')
        .mockResolvedValue(150_000);

      let compressionCallCount = 0;
      harness.deps.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        historyService.clear();
        if (compressionCallCount === 1) {
          historyService.add(makeUserMessage('ineffective compression'));
          estimateSpy.mockResolvedValue(148_000);
          return PerformCompressionResult.COMPRESSED;
        }
        // Second (retry) compression throws a specific underlying error.
        throw new Error('underlying retry cause: network timeout');
      });

      harness.deps.performFallbackCompression.mockResolvedValue(false);

      let thrownError: Error | undefined;
      try {
        await harness.enforcer.enforce(
          { contents, pendingContents: [pending] },
          'test-prompt',
        );
      } catch (error) {
        thrownError = error as Error;
      }

      expect(compressionCallCount).toBe(2);
      expect(thrownError).toBeInstanceOf(Error);
      // The underlying cause must be preserved in actionable diagnostics.
      expect(thrownError!.message).toContain(
        'underlying retry cause: network timeout',
      );
    });
  });

  // -----------------------------------------------------------------------
  // Test H: compressAndRecompose callback contract (Issue #2588 OCR finding)
  //
  // compressAndRecompose is invoked from the provider compression callback
  // (CompressionHandler.attachCompressionCallback). That callback's try/catch
  // expects failure to THROW so the provider can reject the request.
  // runCompressionAndRecompose catches errors/non-COMPRESSED results and
  // returns them as structured compressionFailure — compressAndRecompose must
  // rethrow that failure so the callback contract is honored, while the
  // enforcement orchestration (enforce) continues to consume structured
  // failures for its own retry/truncation/overflow diagnostics.
  // -----------------------------------------------------------------------
  describe('compressAndRecompose callback contract (rethrow compressionFailure)', () => {
    it('throws when performCompression throws during callback compression', async () => {
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: STANDARD_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const pending = makeUserMessage('pending request');

      const harness = buildEnforcerHarness(historyService, runtimeContext);
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        10_000,
      );

      harness.deps.performCompression.mockRejectedValue(
        new Error('callback compression network failure'),
      );

      await expect(
        harness.enforcer.compressAndRecompose([pending], 'test-prompt'),
      ).rejects.toThrow('callback compression network failure');
    });

    it('throws when performCompression returns a non-COMPRESSED result during callback compression', async () => {
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: STANDARD_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const pending = makeUserMessage('pending request');

      const harness = buildEnforcerHarness(historyService, runtimeContext);
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        10_000,
      );

      harness.deps.performCompression.mockResolvedValue(
        PerformCompressionResult.FAILED,
      );

      // A non-COMPRESSED result is a failure in the callback context; it must
      // throw (not silently return unprojected contents).
      await expect(
        harness.enforcer.compressAndRecompose([pending], 'test-prompt'),
      ).rejects.toThrow(/Auto compression did not complete/);
    });

    it('still consumes structured failures in enforce orchestration when compression fails (no rethrow from enforce)', async () => {
      // The enforcement orchestration path (enforce) must NOT rethrow on a
      // single compression failure; it consumes the structured failure and
      // proceeds to truncation. This proves the rethrow is isolated to
      // the compressAndRecompose callback entry point, not enforced globally.
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: STANDARD_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const pending = makeUserMessage('pending request');
      const contents = historyService.getCuratedForProvider([pending]);

      const harness = buildEnforcerHarness(historyService, runtimeContext);
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        150_000,
      );

      harness.deps.performCompression.mockRejectedValue(
        new Error('enforce compression failed'),
      );

      // Truncation also fails, so we observe the final overflow error.
      harness.deps.performFallbackCompression.mockResolvedValue(false);

      let thrownError: Error | undefined;
      try {
        await harness.enforcer.enforce(
          { contents, pendingContents: [pending] },
          'test-prompt',
        );
      } catch (error) {
        thrownError = error as Error;
      }

      // enforce consumed the structured failure and proceeded to truncation;
      // it did NOT rethrow the raw compression error. The diagnostics surface
      // the compression failure as a structured field, not a raw throw.
      expect(thrownError).toBeInstanceOf(Error);
      expect(thrownError!.message).toContain(
        'Automatic compression failed before fallback',
      );
      expect(thrownError!.message).toContain('enforce compression failed');
    });
  });

  // -----------------------------------------------------------------------
  // Finding 3 (CodeRabbit PR #2598): Data integrity bug — silent history loss
  //
  // If performFallbackCompression rejects AND restoring the original history
  // fails, forceTruncation can leave historyService empty. A low projection
  // against that empty history would then fit under the margin-adjusted limit,
  // and enforce() would return "successfully" despite having lost all
  // established history. This must be rejected, not silently accepted.
  // -----------------------------------------------------------------------
  describe('data integrity: rejects instead of silently accepting lost history (CodeRabbit PR #2598)', () => {
    it('throws when fallback rejects, history restoration fails, and empty-history projection fits', async () => {
      runtimeContext = buildRuntimeContext(historyService, {
        contextLimit: STANDARD_CONTEXT_LIMIT,
        compressionThreshold: COMPRESSION_THRESHOLD,
      });

      historyService.add(makeUserMessage('established history'));
      const pending = makeUserMessage('pending request');
      const contents = historyService.getCuratedForProvider([pending]);

      const harness = buildEnforcerHarness(historyService, runtimeContext);

      // Script the projection sequence so the real fallback stage is
      // provably reached:
      // 1. Initial — over-limit
      // 2. Post-density — over-limit
      // 3. Post-first-compression — over-limit, effective (>=5%) to avoid retry
      // 4. Post-truncation — under-limit BUT history was lost
      const estimateSpy = vi.spyOn(historyService, 'estimateTokensForContents');
      // completionBudget = 65_536, marginAdjustedLimit = 199_995
      // estimate > 134_459 → over-limit
      estimateSpy.mockResolvedValueOnce(150_000); // initial
      estimateSpy.mockResolvedValueOnce(150_000); // post-density
      // 150_000 + 65_536 = 215_536, need >=5% reduction: <= 139_223
      // 135_000 + 65_536 = 200_536 > 199_995 (still over)
      estimateSpy.mockResolvedValueOnce(135_000); // post-compression (effective, still over)
      // Post-truncation: empty history fits, but history was lost
      estimateSpy.mockResolvedValueOnce(50_000); // post-truncation

      harness.deps.performCompression.mockImplementation(async () => {
        historyService.clear();
        historyService.add(makeUserMessage('compressed'));
        return PerformCompressionResult.COMPRESSED;
      });

      // Make addAll fail during fallback, so restoreHistory cannot apply
      // either the new or backup history — leaving historyService empty.
      const addAllSpy = vi
        .spyOn(historyService, 'addAll')
        .mockImplementation(() => {
          throw new Error('history persistence layer down');
        });

      // The fallback rejects because restoreHistory throws when addAll fails
      // for both new and backup history.
      harness.deps.performFallbackCompression.mockImplementation(
        async (_promptId, applyResult) => {
          applyResult([makeUserMessage('truncated history')]);
          return true;
        },
      );

      let thrownError: Error | undefined;
      try {
        await harness.enforcer.enforce(
          { contents, pendingContents: [pending] },
          'test-prompt',
        );
      } catch (error) {
        thrownError = error as Error;
      } finally {
        addAllSpy.mockRestore();
      }

      // Enforcement MUST reject rather than silently accept lost history.
      expect(thrownError).toBeInstanceOf(Error);
      expect(thrownError!.message).toContain(
        'Truncation fallback failed during hard-limit enforcement',
      );
      expect(thrownError!.message).toContain('history persistence layer down');
    });
  });
});
