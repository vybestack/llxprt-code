/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ProviderContentEnforcer unsafe-extraction handling
 * (issue #2299). When the pending contents cannot be cleanly extracted
 * (safeToRecompose: false) and the payload exceeds the limit, the enforcer
 * must still attempt compression and truncation before throwing.
 *
 * These tests follow dev-docs/RULES.md: they assert observable behavior
 * (returned contents, error messages, pending preservation) and NEVER assert
 * that mock functions were called.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  makeUserMessage,
  makeAiToolCall,
  makeToolResponse,
  buildRuntimeContext,
} from '../../core/__tests__/chatSession-density-helpers.js';
import {
  ProviderContentEnforcer,
  type ProviderContentEnforcementDeps,
} from '../providerContentEnforcement.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';

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
}

/**
 * Build a ProviderContentEnforcer wired to a real HistoryService with
 * infrastructure-level mocks (token estimation, compression execution).
 * The enforcer itself is real — only its dependencies are mocked.
 */
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
  return { enforcer: new ProviderContentEnforcer(deps), deps, historyService };
}

/**
 * Build contents whose prefix does NOT deep-equal the baseline, so
 * extractPendingContents falls through to the unsafe-extraction branch
 * (safeToRecompose: false). This is achieved by mutating the timestamp
 * metadata on the first entry, which defeats both the prefix-match and the
 * recomposition-identity checks.
 */
function buildUnsafeExtractionContents(
  baselinePrefix: IContent[],
  pending: IContent,
): IContent[] {
  const mutatedPrefix: IContent[] = baselinePrefix.map((content, index) => {
    if (index === 0) {
      return {
        ...content,
        metadata: { ...content.metadata, timestamp: -1 },
      };
    }
    return content;
  });
  return [...mutatedPrefix, pending];
}

/**
 * Token estimate that puts the initial projection above both the compression
 * threshold and the margin-adjusted limit, forcing the enforcer into the
 * overflow/compression path.
 *
 * With contextLimit=200_000 and the default completion budget (65_536):
 *   compressionThreshold = min(199_000, 0.8 * 134_464 + 65_536) = 172_107
 *   marginAdjustedLimit   = 199_000
 *   initialProjected      = OVERFLOW_TOKENS + 65_536 = 199_536 > 199_000
 */
const OVERFLOW_TOKENS = 134_000;

describe('ProviderContentEnforcer unsafe-extraction compression (issue #2299)', () => {
  let historyService: HistoryService;
  let runtimeContext: AgentRuntimeContext;

  beforeEach(() => {
    vi.clearAllMocks();
    historyService = new HistoryService();
    runtimeContext = buildRuntimeContext(historyService, {
      contextLimit: 200_000,
      compressionThreshold: 0.8,
    });
  });

  it('succeeds (does not throw "reduced 0 tokens") when extraction is unsafe and compression resolves the overflow', async () => {
    historyService.add(makeUserMessage('established history'));
    const baseline = historyService.getCuratedForProvider();
    const pending = makeUserMessage('new pending request');
    const contents = buildUnsafeExtractionContents(baseline, pending);

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    const estimateSpy = vi
      .spyOn(historyService, 'estimateTokensForContents')
      .mockResolvedValue(OVERFLOW_TOKENS);

    // The real CompressionHandler clears and re-adds compressed entries.
    // Simulate that here so recomposeProviderContents observes a changed
    // history — this is the observable effect of compression, not a mock call.
    harness.deps.performCompression.mockImplementation(async () => {
      historyService.clear();
      historyService.add(makeUserMessage('compressed summary'));
      estimateSpy.mockResolvedValue(1_000);
      return PerformCompressionResult.COMPRESSED;
    });

    // Before the fix, this threw "reduced 0 tokens". Now it must succeed.
    const result = await harness.enforcer.enforce(contents, 'test-prompt');

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('preserves the pending content in the returned contents when extraction is unsafe', async () => {
    historyService.add(makeUserMessage('established history'));
    const baseline = historyService.getCuratedForProvider();
    const pending = makeUserMessage('new pending request');
    const contents = buildUnsafeExtractionContents(baseline, pending);

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    const estimateSpy = vi
      .spyOn(historyService, 'estimateTokensForContents')
      .mockResolvedValue(OVERFLOW_TOKENS);

    harness.deps.performCompression.mockImplementation(async () => {
      historyService.clear();
      historyService.add(makeUserMessage('compressed summary'));
      estimateSpy.mockResolvedValue(1_000);
      return PerformCompressionResult.COMPRESSED;
    });

    const result = await harness.enforcer.enforce(contents, 'test-prompt');

    expect(result).toContainEqual(pending);
  });

  it('reports a non-zero token reduction in the error when compression succeeds but the payload still exceeds the limit', async () => {
    historyService.add(makeUserMessage('established history'));
    const baseline = historyService.getCuratedForProvider();
    const pending = makeUserMessage('new pending request');
    const contents = buildUnsafeExtractionContents(baseline, pending);

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    const estimateSpy = vi
      .spyOn(historyService, 'estimateTokensForContents')
      .mockResolvedValue(140_000);

    // Compression "happens" (updates history) and genuinely lowers the token
    // estimate, but it still exceeds the margin-adjusted limit. The fallback
    // also fails to bring it down.
    harness.deps.performCompression.mockImplementation(async () => {
      historyService.clear();
      historyService.add(
        makeUserMessage('compressed summary that is still large'),
      );
      // Lower than 140_000 but 136_000 + 65_536 = 201_536 > 199_000 (still over).
      estimateSpy.mockResolvedValue(136_000);
      return PerformCompressionResult.COMPRESSED;
    });

    let thrownError: Error | undefined;
    try {
      await harness.enforcer.enforce(contents, 'test-prompt');
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    const message = thrownError!.message;
    // The error must mention a reduction happened (the bug was "reduced 0 tokens").
    expect(message).toContain('reduced');
    // It must NOT say "reduced 0 tokens" — that is the regression signature.
    expect(message).not.toContain('reduced 0 tokens');
  });

  it('applies fallback truncation history via the callback and reports a non-zero reduction when the payload still exceeds the limit', async () => {
    historyService.add(makeUserMessage('established history'));
    const baseline = historyService.getCuratedForProvider();
    const pending = makeUserMessage('new pending request');
    const contents = buildUnsafeExtractionContents(baseline, pending);

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    const estimateSpy = vi
      .spyOn(historyService, 'estimateTokensForContents')
      .mockResolvedValue(140_000);

    harness.deps.performCompression.mockImplementation(async () => {
      historyService.clear();
      historyService.add(
        makeUserMessage('compressed summary that is still large'),
      );
      // Lower than 140_000 but 136_000 + 65_536 = 201_536 > 199_000 (still over).
      estimateSpy.mockResolvedValue(136_000);
      return PerformCompressionResult.COMPRESSED;
    });

    // The fallback callback applies a truncated history to the real history
    // service, mirroring what the real CompressionHandler does. The estimate
    // stays above the limit so the enforcer must throw with a non-zero
    // reduction (the behavioral outcome of having attempted fallback).
    harness.deps.performFallbackCompression.mockImplementation(
      async (_promptId, applyResult) => {
        applyResult([makeUserMessage('truncated history')]);
        return true;
      },
    );

    const error = await harness.enforcer
      .enforce(contents, 'test-prompt')
      .catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('reduced');
    expect((error as Error).message).not.toContain('reduced 0 tokens');
  });

  it('compressAndRecompose returns recomposed contents reflecting compressed history, not the original unchanged payload', async () => {
    historyService.add(makeUserMessage('established history before pending'));
    const baseline = historyService.getCuratedForProvider();
    const pending = makeUserMessage('new pending request');
    const contents = buildUnsafeExtractionContents(baseline, pending);

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
      10_000,
    );

    // Compression replaces the history with different content.
    harness.deps.performCompression.mockImplementation(async () => {
      historyService.clear();
      historyService.add(makeUserMessage('compressed summary'));
      return PerformCompressionResult.COMPRESSED;
    });

    const result = await harness.enforcer.compressAndRecompose(
      contents,
      'test-prompt',
    );

    // The returned contents must reflect the recomposed (compressed) history,
    // meaning the original established-history text must be gone and replaced
    // by the compressed summary. If the implementation ignored compression,
    // 'established history before pending' would still be present.
    const allText = result
      .map((c) =>
        c.blocks
          .filter((b) => b.type === 'text')
          .map((b) => (b as { text: string }).text)
          .join(' '),
      )
      .join(' ');
    expect(allText).toContain('compressed summary');
    expect(allText).not.toContain('established history before pending');
    // The pending content must be preserved.
    expect(result).toContainEqual(pending);
  });

  it('preserves pending content after enforcement when buildProviderContent normalizes tool-call/tool-response structure into a different-length prefix (issue #2299 normalization shift)', async () => {
    // Build curated history with a tool-call/tool-response structure that
    // buildProviderContent normalizes (e.g., adds synthetic responses for
    // orphaned calls, reorders, or splits). This makes the provider-space
    // length differ from the raw curated length.
    const readCall = makeAiToolCall('read_file', {
      file_path: '/tmp/data.txt',
    });
    historyService.add(readCall.entry);
    historyService.add(
      makeToolResponse(readCall.callId, 'read_file', 'file contents'),
    );
    historyService.add(makeUserMessage('established user turn'));

    const baseline = historyService.getCuratedForProvider();
    const pending = makeUserMessage('new pending request after normalization');
    const contents = buildUnsafeExtractionContents(baseline, pending);

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    const estimateSpy = vi
      .spyOn(historyService, 'estimateTokensForContents')
      .mockResolvedValue(OVERFLOW_TOKENS);

    harness.deps.performCompression.mockImplementation(async () => {
      historyService.clear();
      historyService.add(makeUserMessage('compressed summary'));
      estimateSpy.mockResolvedValue(1_000);
      return PerformCompressionResult.COMPRESSED;
    });

    const result = await harness.enforcer.enforce(contents, 'test-prompt');

    // After enforcement, the pending content must survive the
    // normalization-shift fallback path and remain the last entry.
    expect(result.at(-1)).toStrictEqual(pending);
  });
});
