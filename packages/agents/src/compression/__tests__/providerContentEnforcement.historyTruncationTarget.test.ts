/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral regression for issue #3406.
 *
 * TopDownTruncation is the last-resort history truncator for hard-limit
 * enforcement, but it used to decide whether to act by comparing committed
 * history against `compressionThreshold * contextLimit * 0.6`. The enforcer
 * that invokes it has to fit the whole finalized envelope — system prompt,
 * tool schemas, committed history and pending content — under the context
 * budget. Those are different quantities, so whenever the envelope overhead
 * pushed the request over the limit while committed history stayed under the
 * strategy's own target, the truncator declared `already-under-target` and did
 * nothing. Every reduction stage then declined and the user got the overflow
 * guard with nothing compressed.
 *
 * These tests use the REAL ProviderContentEnforcer over a REAL HistoryService
 * with real token estimation, and drive the REAL TopDownTruncationStrategy
 * through the REAL compression-context builder behind the
 * performFallbackCompression dependency — the same wiring CompressionHandler
 * uses. Nothing asserts on a mock call; the assertions are about whether the
 * payload genuinely came back under budget.
 */

import { describe, it, expect, vi } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type { ProviderContentEnvelope } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import {
  ProviderContentEnforcer,
  type ProviderContentEnforcementDeps,
} from '../providerContentEnforcement.js';
import { TopDownTruncationStrategy } from '../TopDownTruncationStrategy.js';
import { buildCompressionContext } from '../compressionContextBuilder.js';
import { computeMarginAdjustedLimit } from '../contextLimitPolicy.js';

const MODEL = 'test-model';
const COMPRESSION_THRESHOLD = 0.8;
const CONTEXT_LIMIT = 20_000;
const COMPLETION_BUDGET = 10_000;

function makeLogger(): DebugLogger {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as DebugLogger;
}

function buildRuntimeContext(
  historyService: HistoryService,
): AgentRuntimeContext {
  const state = createAgentRuntimeState({
    runtimeId: 'pce-history-target-test',
    provider: 'test',
    model: MODEL,
    sessionId: 'test-session',
  });
  return createAgentRuntimeContext({
    state,
    history: historyService,
    settings: {
      compressionThreshold: COMPRESSION_THRESHOLD,
      contextLimit: CONTEXT_LIMIT,
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

function textContent(speaker: IContent['speaker'], text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function buildEnvelope(
  contents: IContent[],
  pendingContents: IContent[],
): ProviderContentEnvelope {
  return { contents, pendingContents } as ProviderContentEnvelope;
}

/**
 * Wire performFallbackCompression exactly as CompressionHandler does: build a
 * real compression context carrying the caller-supplied target, run the real
 * TopDownTruncationStrategy, and commit its candidate history.
 */
function buildFallbackCompression(
  historyService: HistoryService,
  runtimeContext: AgentRuntimeContext,
  logger: DebugLogger,
): ProviderContentEnforcementDeps['performFallbackCompression'] {
  return async (promptId, applyResult, targetTokenCount) => {
    const context = await buildCompressionContext(
      promptId,
      runtimeContext,
      historyService,
      () =>
        Promise.resolve({
          provider: {} as never,
          runtime: {} as never,
        }),
      undefined,
      undefined,
      logger,
      { targetTokenCount },
    );
    const result = await new TopDownTruncationStrategy().compress(context);
    if (result.kind === 'noop') {
      return false;
    }
    await applyResult(result.newHistory);
    return true;
  };
}

interface Harness {
  enforcer: ProviderContentEnforcer;
  historyService: HistoryService;
  pending: IContent[];
  envelope: ProviderContentEnvelope;
}

/**
 * Build a conversation whose committed history sits UNDER the strategy's own
 * ephemeral target while the finalized envelope (history plus pending) sits
 * OVER the enforcer's budget. That is the shape that used to defeat every
 * reduction stage.
 */
async function buildHarness(): Promise<Harness> {
  const historyService = new HistoryService();
  const runtimeContext = buildRuntimeContext(historyService);
  const logger = makeLogger();

  for (let i = 0; i < 12; i++) {
    historyService.add(
      textContent(
        i % 2 === 0 ? 'human' : 'ai',
        `message ${i} ${'word '.repeat(550)}`,
      ),
    );
  }
  await historyService.waitForTokenUpdates();

  const pending = [textContent('human', `pending ${'word '.repeat(500)}`)];

  const deps: ProviderContentEnforcementDeps = {
    historyService,
    runtimeContext,
    generationConfig: { maxOutputTokens: COMPLETION_BUDGET },
    providerRuntimeNullable: undefined,
    logger,
    ensureDensityOptimized: vi.fn().mockResolvedValue(undefined),
    // Middle-out and one-shot both refuse on a small number of large
    // messages, which is what the reported session hit.
    performCompression: vi
      .fn()
      .mockResolvedValue(PerformCompressionResult.NOOP),
    performFallbackCompression: buildFallbackCompression(
      historyService,
      runtimeContext,
      logger,
    ),
    getPromptTokenBaseline: () => null,
    resetPromptTokenBaseline: () => {},
    restorePromptTokenBaseline: () => {},
  };

  return {
    enforcer: new ProviderContentEnforcer(deps),
    historyService,
    pending,
    envelope: buildEnvelope(
      [...historyService.getCurated(), ...pending],
      pending,
    ),
  };
}

describe('ProviderContentEnforcer history-truncation target (issue #3406)', () => {
  it('truncates history to fit when the envelope overflows but committed history is under the strategy target', async () => {
    const { enforcer, historyService, pending } = await buildHarness();

    const marginAdjustedLimit = computeMarginAdjustedLimit(CONTEXT_LIMIT);
    const inputBudget = marginAdjustedLimit - COMPLETION_BUDGET;
    const ephemeralTarget = COMPRESSION_THRESHOLD * CONTEXT_LIMIT * 0.6;
    const historyTokens = historyService.getTotalTokens();
    const envelopeTokens = await historyService.estimateTokensForContents(
      [...historyService.getCurated(), ...pending],
      MODEL,
    );

    // Preconditions that define the bug. If token estimation drifts these
    // fail loudly rather than letting the regression silently stop applying.
    expect(envelopeTokens).toBeGreaterThan(inputBudget);
    expect(historyTokens).toBeLessThanOrEqual(ephemeralTarget);

    const envelope = buildEnvelope(
      [...historyService.getCurated(), ...pending],
      pending,
    );
    const result = await enforcer.enforce(envelope, 'prompt-3406', undefined);

    const finalTokens = await historyService.estimateTokensForContents(
      result,
      MODEL,
    );
    expect(finalTokens).toBeLessThanOrEqual(inputBudget);
    // Truncation really removed the oldest entries rather than reporting
    // success over an unchanged history.
    expect(historyService.getTotalTokens()).toBeLessThan(historyTokens);
  });

  it('leaves history alone when the envelope already fits', async () => {
    const { enforcer, historyService } = await buildHarness();
    const historyTokens = historyService.getTotalTokens();

    // A tiny pending message against the same history is comfortably inside
    // the budget once the completion reservation is small.
    const smallPending = [textContent('human', 'hi')];
    const envelope = buildEnvelope(
      [...historyService.getCurated(), ...smallPending],
      smallPending,
    );

    const result = await enforcer.enforce(
      envelope,
      'prompt-3406-fits',
      undefined,
    );

    expect(result.length).toBeGreaterThan(0);
    expect(historyService.getTotalTokens()).toBe(historyTokens);
  });
});
