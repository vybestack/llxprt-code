/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ProviderContentEnforcer envelope-based enforcement
 * (issue #2304). The pending-content boundary is now threaded explicitly via
 * a ProviderContentEnvelope, eliminating the fragile extraction heuristics.
 *
 * These tests follow dev-docs/RULES.md: they assert observable behavior
 * (returned contents, error messages, pending preservation) and NEVER assert
 * that mock functions were called.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  makeUserMessage,
  makeAiText,
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
 * Token estimate that puts the initial projection above both the compression
 * threshold and the margin-adjusted limit, forcing the enforcer into the
 * overflow/compression path.
 *
 * With contextLimit=200_000 and the default completion budget (65_536):
 *   compressionThreshold = min(199_995, 0.8 * 134_464 + 65_536) = 173_107.2
 *   marginAdjustedLimit   = min(200_000, floor(199_000 + 199_000*0.005)) = 199_995
 *   initialProjected      = OVERFLOW_TOKENS + 65_536 = 200_536 > 199_995
 */
const OVERFLOW_TOKENS = 135_000;

describe('ProviderContentEnforcer envelope-based enforcement (issue #2304)', () => {
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

  it('preserves pending content in returned contents when compression resolves overflow', async () => {
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('new pending request');
    const contents = historyService.getCuratedForProvider([pending]);

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

    const result = await harness.enforcer.enforce(
      { contents, pendingContents: [pending] },
      'test-prompt',
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContainEqual(pending);
  });

  it('reports a non-zero token reduction in the error when compression succeeds but the payload still exceeds the limit', async () => {
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('new pending request');
    const contents = historyService.getCuratedForProvider([pending]);

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    const estimateSpy = vi
      .spyOn(historyService, 'estimateTokensForContents')
      .mockResolvedValue(140_000);

    harness.deps.performCompression.mockImplementation(async () => {
      historyService.clear();
      historyService.add(
        makeUserMessage('compressed summary that is still large'),
      );
      estimateSpy.mockResolvedValue(136_000);
      return PerformCompressionResult.COMPRESSED;
    });

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
    const message = thrownError!.message;
    expect(message).toContain('reduced');
    expect(message).not.toContain('reduced 0 tokens');
  });

  it('applies fallback truncation and reports a non-zero reduction when the payload still exceeds the limit', async () => {
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('new pending request');
    const contents = historyService.getCuratedForProvider([pending]);

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    const estimateSpy = vi
      .spyOn(historyService, 'estimateTokensForContents')
      .mockResolvedValue(140_000);

    harness.deps.performCompression.mockImplementation(async () => {
      historyService.clear();
      historyService.add(
        makeUserMessage('compressed summary that is still large'),
      );
      estimateSpy.mockResolvedValue(136_000);
      return PerformCompressionResult.COMPRESSED;
    });

    harness.deps.performFallbackCompression.mockImplementation(
      async (_promptId, applyResult) => {
        applyResult([makeUserMessage('truncated history')]);
        return true;
      },
    );

    const error = await harness.enforcer
      .enforce({ contents, pendingContents: [pending] }, 'test-prompt')
      .catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('reduced');
    expect((error as Error).message).not.toContain('reduced 0 tokens');
  });

  it('compressAndRecompose returns recomposed contents reflecting compressed history', async () => {
    historyService.add(makeUserMessage('established history before pending'));
    const pending = makeUserMessage('new pending request');

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
      10_000,
    );

    harness.deps.performCompression.mockImplementation(async () => {
      historyService.clear();
      historyService.add(makeUserMessage('compressed summary'));
      return PerformCompressionResult.COMPRESSED;
    });

    const result = await harness.enforcer.compressAndRecompose(
      [pending],
      'test-prompt',
    );

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
    expect(result).toContainEqual(pending);
  });

  it('preserves pending after normalization shift (tool-call/tool-response structure)', async () => {
    const readCall = makeAiToolCall('read_file', {
      file_path: '/tmp/data.txt',
    });
    historyService.add(readCall.entry);
    historyService.add(
      makeToolResponse(readCall.callId, 'read_file', 'file contents'),
    );
    historyService.add(makeUserMessage('established user turn'));

    const pending = makeUserMessage('new pending request after normalization');
    const contents = historyService.getCuratedForProvider([pending]);

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

    const result = await harness.enforcer.enforce(
      { contents, pendingContents: [pending] },
      'test-prompt',
    );

    expect(result.at(-1)).toStrictEqual(pending);
  });

  it('compresses successfully when pendingContents came from differential recovery', async () => {
    // Simulate the hook-modified path: an envelope whose pendingContents was
    // recovered via differential analysis (a text-only round-trip equivalent).
    // Compression must still work and preserve the recovered pending item.
    historyService.add(makeUserMessage('established history one'));
    historyService.add(makeAiText('established ai reply'));
    const pending = makeUserMessage('recovered pending request');
    const contents = historyService.getCuratedForProvider([pending]);

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

    // The recovered pending is a projection-equivalent text-only IContent
    // (metadata/ids stripped, as the hook translator would produce).
    const recoveredPending: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'recovered pending request' }],
    };
    const result = await harness.enforcer.enforce(
      { contents, pendingContents: [recoveredPending] },
      'test-prompt',
    );

    // The recovered pending text is preserved as the final message even though
    // buildProviderContent deep-clones (so the object identity differs).
    const lastText = result
      .at(-1)
      ?.blocks.filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join(' ');
    expect(lastText).toBe('recovered pending request');
  });

  it('throws a clear error when pendingContents is undefined and compression is needed', async () => {
    historyService.add(makeUserMessage('established history'));
    const contents = historyService.getCuratedForProvider();

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
      OVERFLOW_TOKENS,
    );

    let thrownError: Error | undefined;
    try {
      await harness.enforcer.enforce(
        { contents, pendingContents: undefined },
        'test-prompt',
      );
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError!.message.toLowerCase()).toContain('unrecoverable');
    expect(thrownError!.message.toLowerCase()).toContain(
      'llm_request_boundary',
    );
    expect(thrownError!.message.toLowerCase()).toContain('compression');
  });

  it('returns contents as-is when pendingContents is undefined but under hard limit', async () => {
    historyService.add(makeUserMessage('established history'));
    const contents = historyService.getCuratedForProvider();

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    // Over the compression threshold (172_107) but under the margin-adjusted
    // limit (199_000): 180_000 - 65_536 = 114_464 for the estimate.
    vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
      114_464,
    );

    const result = await harness.enforcer.enforce(
      { contents, pendingContents: undefined },
      'test-prompt',
    );

    expect(result).toStrictEqual(contents);
  });

  it('enforces the modified-history UNRECOVERABLE policy: undefined pending (from modified-history outcome) is returned as-is under the limit', async () => {
    // R1 enforcement-policy test: when recoverPendingBoundary returns
    // classification 'modified-history' with pendingContents undefined (history
    // prefix changed but pending suffix intact), compression must NOT recompose
    // (which would discard history edits). Under the margin-adjusted limit the
    // envelope is returned as-is.
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('new pending');
    const contents = historyService.getCuratedForProvider([pending]);

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
      114_464,
    );

    // pendingContents undefined, as produced by a modified-history outcome.
    const result = await harness.enforcer.enforce(
      { contents, pendingContents: undefined },
      'test-prompt',
    );

    expect(result).toStrictEqual(contents);
  });

  it('enforces the modified-history UNRECOVERABLE policy: undefined pending throws the clear unrecoverable-boundary error when over the limit', async () => {
    // R1 enforcement-policy test: over the margin-adjusted limit, the
    // modified-history outcome (pendingContents undefined) must throw the clear
    // unrecoverable-boundary error rather than attempting compression.
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('new pending');
    const contents = historyService.getCuratedForProvider([pending]);

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
      OVERFLOW_TOKENS,
    );

    let thrownError: Error | undefined;
    try {
      await harness.enforcer.enforce(
        { contents, pendingContents: undefined },
        'test-prompt',
      );
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError!.message.toLowerCase()).toContain('unrecoverable');
  });

  it('pure-prepend outcome (undefined pending) returns contents as-is INCLUDING preamble when under the limit', async () => {
    // F1 regression: a pure-prepend outcome produces pendingContents undefined
    // (the prepended content lives on the history side and would be silently
    // dropped by recomposition). Under the margin-adjusted limit, enforcement
    // must return the hook-modified contents as-is — nothing silently lost.
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('new pending');
    // Simulate the hook-modified contents: a preamble prepended before the
    // original history + pending.
    const preamble = makeUserMessage('preamble from hook');
    const baseContents = historyService.getCuratedForProvider([pending]);
    const prependModifiedContents = [preamble, ...baseContents];

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    // Under the margin-adjusted limit (199_000): estimate < 199_000 - 65_536.
    vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
      114_464,
    );

    // pendingContents undefined, as recoverPendingBoundary now produces for a
    // pure-prepend outcome.
    const result = await harness.enforcer.enforce(
      { contents: prependModifiedContents, pendingContents: undefined },
      'test-prompt',
    );

    // The ENTIRE hook-modified contents are returned as-is — including the
    // prepended preamble. Nothing is silently dropped.
    expect(result).toStrictEqual(prependModifiedContents);
    expect(result).toContainEqual(preamble);
    expect(result).toContainEqual(pending);
  });

  it('pure-prepend outcome (undefined pending) throws the clear unrecoverable-boundary error when over the limit', async () => {
    // F1 regression: over the margin-adjusted limit, a pure-prepend outcome
    // (pendingContents undefined) must throw the clear unrecoverable-boundary
    // error mentioning llm_request_boundary rather than silently dropping the
    // preamble via recomposition.
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('new pending');
    const preamble = makeUserMessage('preamble from hook');
    const baseContents = historyService.getCuratedForProvider([pending]);
    const prependModifiedContents = [preamble, ...baseContents];

    const harness = buildEnforcerHarness(historyService, runtimeContext);
    vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
      OVERFLOW_TOKENS,
    );

    let thrownError: Error | undefined;
    try {
      await harness.enforcer.enforce(
        { contents: prependModifiedContents, pendingContents: undefined },
        'test-prompt',
      );
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError!.message.toLowerCase()).toContain('unrecoverable');
    expect(thrownError!.message.toLowerCase()).toContain(
      'llm_request_boundary',
    );
  });
});
