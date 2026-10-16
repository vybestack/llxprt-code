/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for pending-boundary enforcement through the product
 * source ladder (issue #2304). The pending-content boundary is threaded
 * explicitly into CompressionHandler.enforceProviderSource, eliminating the
 * fragile extraction heuristics.
 *
 * These tests follow dev-docs/RULES.md: they assert observable behavior
 * (returned rows, error messages, pending preservation) and NEVER assert
 * that mock functions were called.
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  makeUserMessage,
  makeAiToolCall,
  makeToolResponse,
  buildRuntimeContext,
} from '../../core/__tests__/chatSession-density-helpers.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { installFixtureCandidate } from './provider-fallback-candidate-fixture.js';
import { enforceProviderSourceForTest } from './support/enforce-provider-source.js';
import {
  buildHandlerHarness,
  type HandlerHarness,
} from './support/handler-harness.js';

/**
 * Token estimate that puts the initial projection above both the compression
 * threshold and the margin-adjusted limit, forcing the ladder into the
 * overflow/compression path.
 *
 * With contextLimit=200_000 and the default completion budget (65_536):
 *   compressionThreshold = min(199_995, 0.8 * 134_464 + 65_536) = 173_107.2
 *   marginAdjustedLimit   = min(200_000, floor(199_000 + 199_000*0.005)) = 199_995
 *   initialProjected      = OVERFLOW_TOKENS + 65_536 = 200_536 > 199_995
 */
const OVERFLOW_TOKENS = 135_000;
let historyService: HistoryService;
let runtimeContext: AgentRuntimeContext;
let harness: HandlerHarness;

function replaceHistoryWithSummary(
  text: string,
  estimateSpy: { mockResolvedValue: (value: number) => unknown },
  tokensAfter: number,
): void {
  harness.performCompression.mockImplementation(async () => {
    historyService.clear();
    historyService.add(makeUserMessage(text));
    estimateSpy.mockResolvedValue(tokensAfter);
    return PerformCompressionResult.COMPRESSED;
  });
}

function textOf(rows: ReadonlyArray<{ blocks: unknown[] }>): string {
  return rows
    .flatMap((row) => row.blocks as Array<{ type: string; text?: string }>)
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(' ');
}

describe('CompressionHandler pending-boundary enforcement (issue #2304)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    historyService = new HistoryService();
    runtimeContext = buildRuntimeContext(historyService, {
      contextLimit: 200_000,
      compressionThreshold: 0.8,
    });
    harness = buildHandlerHarness(historyService, runtimeContext);
  });

  it('preserves pending content in returned rows when compression resolves overflow', async () => {
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('new pending request');
    const estimateSpy = vi
      .spyOn(historyService, 'estimateTokensForContents')
      .mockResolvedValue(OVERFLOW_TOKENS);
    replaceHistoryWithSummary('compressed summary', estimateSpy, 1_000);

    const result = await enforceProviderSourceForTest(
      harness.handler,
      historyService,
      [pending],
      'test-prompt',
      undefined,
    );

    expect(result.length).toBeGreaterThan(0);
    expect(result).toContainEqual(pending);
    expect(textOf(result)).toContain('compressed summary');
    expect(textOf(result)).not.toContain('established history');
  });

  it('reports a non-zero token reduction in the error when compression succeeds but the payload still exceeds the limit', async () => {
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('new pending request');
    const estimateSpy = vi
      .spyOn(historyService, 'estimateTokensForContents')
      .mockResolvedValue(140_000);
    replaceHistoryWithSummary(
      'compressed summary that is still large',
      estimateSpy,
      136_000,
    );

    const error = await enforceProviderSourceForTest(
      harness.handler,
      historyService,
      [pending],
      'test-prompt',
      undefined,
    ).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('reduced');
    expect((error as Error).message).not.toContain('reduced 0 tokens');
  });

  it('applies fallback truncation and reports a non-zero reduction when the payload still exceeds the limit', async () => {
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('new pending request');
    const estimateSpy = vi
      .spyOn(historyService, 'estimateTokensForContents')
      .mockResolvedValue(140_000);
    replaceHistoryWithSummary(
      'compressed summary that is still large',
      estimateSpy,
      136_000,
    );
    harness.setDiskFallback(async (_promptId, install) => {
      await installFixtureCandidate(install, [
        makeUserMessage('truncated history'),
      ]);
      return true;
    });

    const error = await enforceProviderSourceForTest(
      harness.handler,
      historyService,
      [pending],
      'test-prompt',
      undefined,
    ).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('reduced');
    expect((error as Error).message).not.toContain('reduced 0 tokens');
  });

  it('keeps pending last after normalization shift (tool-call/tool-response structure)', async () => {
    const readCall = makeAiToolCall('read_file', {
      file_path: '/tmp/data.txt',
    });
    historyService.add(readCall.entry);
    historyService.add(
      makeToolResponse(readCall.callId, 'read_file', 'file contents'),
    );
    historyService.add(makeUserMessage('established user turn'));
    const pending = makeUserMessage('new pending request after normalization');
    const estimateSpy = vi
      .spyOn(historyService, 'estimateTokensForContents')
      .mockResolvedValue(OVERFLOW_TOKENS);
    replaceHistoryWithSummary('compressed summary', estimateSpy, 1_000);

    const result = await enforceProviderSourceForTest(
      harness.handler,
      historyService,
      [pending],
      'test-prompt',
      undefined,
    );

    expect(result.at(-1)).toStrictEqual(pending);
  });

  it('compresses successfully when pending came from differential recovery (text-only, ids stripped)', async () => {
    historyService.add(makeUserMessage('established history one'));
    const recoveredPending = {
      speaker: 'human' as const,
      blocks: [{ type: 'text' as const, text: 'recovered pending request' }],
    };
    const estimateSpy = vi
      .spyOn(historyService, 'estimateTokensForContents')
      .mockResolvedValue(OVERFLOW_TOKENS);
    replaceHistoryWithSummary('compressed summary', estimateSpy, 1_000);

    const result = await enforceProviderSourceForTest(
      harness.handler,
      historyService,
      [recoveredPending],
      'test-prompt',
      undefined,
    );

    expect(textOf([result.at(-1) ?? { blocks: [] }])).toBe(
      'recovered pending request',
    );
  });

  it('throws the clear unrecoverable-boundary error when the pending boundary is unrecoverable and compression is needed', async () => {
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('new pending');
    vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
      OVERFLOW_TOKENS,
    );

    const error = await enforceProviderSourceForTest(
      harness.handler,
      historyService,
      [pending],
      'test-prompt',
      undefined,
      undefined,
      false,
    ).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message.toLowerCase();
    expect(message).toContain('unrecoverable');
    expect(message).toContain('llm_request_boundary');
    expect(message).toContain('compression');
  });

  it('returns rows as-is when the pending boundary is unrecoverable but the request is under the hard limit', async () => {
    historyService.add(makeUserMessage('established history'));
    const pending = makeUserMessage('new pending');
    // Over the compression threshold (173_107) but under the margin-adjusted
    // limit (199_995): 180_000 - 65_536 = 114_464 for the estimate.
    vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
      114_464,
    );

    const result = await enforceProviderSourceForTest(
      harness.handler,
      historyService,
      [pending],
      'test-prompt',
      undefined,
      undefined,
      false,
    );

    expect(textOf(result)).toBe('established history new pending');
    expect(result.at(-1)).toStrictEqual(pending);
  });
});
