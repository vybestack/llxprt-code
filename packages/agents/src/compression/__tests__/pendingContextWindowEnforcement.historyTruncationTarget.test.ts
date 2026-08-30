/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral regression for issue #3406 on the HTTP 413 recovery path.
 *
 * PendingContextWindowEnforcer has the same defect the provider-content path
 * had: its TopDownTruncation fallback used to derive its own target from
 * `compressionThreshold * contextLimit * 0.6`, which only measures committed
 * history, while the enforcer has to fit committed history plus the pending
 * request plus the completion reservation under the context limit. When the
 * pending request supplied the overage, the truncator declared itself already
 * under target and recovery failed with nothing compressed.
 *
 * These tests drive the REAL PendingContextWindowEnforcer against a REAL
 * HistoryService, building a REAL compression context and running the REAL
 * TopDownTruncationStrategy behind the enforcer's dependencies.
 */

import { describe, it, expect, vi } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  PendingContextWindowEnforcer,
  type PendingContextWindowEnforcerDeps,
} from '../pendingContextWindowEnforcement.js';
import { TopDownTruncationStrategy } from '../TopDownTruncationStrategy.js';
import { buildCompressionContext } from '../compressionContextBuilder.js';
import { computeMarginAdjustedLimit } from '../contextLimitPolicy.js';

const MODEL = 'test-model';
const COMPRESSION_THRESHOLD = 0.8;
const CONTEXT_LIMIT = 20_000;
const COMPLETION_BUDGET = 10_000;
const PENDING_TOKENS = 600;

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

function buildRuntimeContext(
  historyService: HistoryService,
): AgentRuntimeContext {
  const state = createAgentRuntimeState({
    runtimeId: 'pending-history-target-test',
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

interface Harness {
  enforcer: PendingContextWindowEnforcer;
  historyService: HistoryService;
  marginAdjustedLimit: number;
}

async function buildHarness(): Promise<Harness> {
  const historyService = new HistoryService();
  const runtimeContext = buildRuntimeContext(historyService);
  const logger = makeLogger();
  const marginAdjustedLimit = computeMarginAdjustedLimit(CONTEXT_LIMIT);

  for (let i = 0; i < 12; i++) {
    historyService.add(
      textContent(
        i % 2 === 0 ? 'human' : 'ai',
        `message ${i} ${'word '.repeat(550)}`,
      ),
    );
  }
  await historyService.waitForTokenUpdates();

  const deps: PendingContextWindowEnforcerDeps = {
    historyService,
    logger,
    ineffectiveCompressionReductionThreshold: 0.05,
    getContextLimits: () => ({
      completionBudget: COMPLETION_BUDGET,
      limit: CONTEXT_LIMIT,
      marginAdjustedLimit,
    }),
    computeProjectedTokens: (pendingTokens, completionBudget) =>
      historyService.getTotalTokens() +
      Math.max(0, pendingTokens) +
      completionBudget,
    ensureDensityOptimized: async () => {},
    // Middle-out and one-shot both refuse on a small number of large
    // messages, which is the shape the reported session hit.
    performCompression: async () => PerformCompressionResult.NOOP,
    buildCompressionContext: (promptId, targetTokenCount) =>
      buildCompressionContext(
        promptId,
        runtimeContext,
        historyService,
        () => Promise.resolve({ provider: {} as never, runtime: {} as never }),
        undefined,
        undefined,
        logger,
        { targetTokenCount },
      ),
    compressWithFallbackStrategy: (context) =>
      new TopDownTruncationStrategy().compress(context),
    applyFallbackCompressionResult: async (result, applyResult) => {
      if (result.kind === 'noop') {
        return;
      }
      await applyResult(result.newHistory, undefined, 0);
    },
    setSuppressDensityDirty: () => {},
    recordCompressionFailure: () => {},
    resetLastPromptTokenCount: () => {},
    getRuntimeModel: () => MODEL,
    estimateBlockTokensAsync: async () => 0,
  };

  return {
    enforcer: new PendingContextWindowEnforcer(deps),
    historyService,
    marginAdjustedLimit,
  };
}

describe('PendingContextWindowEnforcer history-truncation target (issue #3406)', () => {
  it('truncates history to fit when the pending request supplies the overage', async () => {
    const { enforcer, historyService, marginAdjustedLimit } =
      await buildHarness();

    const historyTokens = historyService.getTotalTokens();
    const ephemeralTarget = COMPRESSION_THRESHOLD * CONTEXT_LIMIT * 0.6;
    const projected = historyTokens + PENDING_TOKENS + COMPLETION_BUDGET;

    // Preconditions that define the bug: the request overflows, yet committed
    // history alone sits under the strategy's own target.
    expect(projected).toBeGreaterThan(marginAdjustedLimit);
    expect(historyTokens).toBeLessThanOrEqual(ephemeralTarget);

    await enforcer.enforce(PENDING_TOKENS, 'prompt-3406-pending', undefined);

    const remaining = historyService.getTotalTokens();
    expect(remaining).toBeLessThan(historyTokens);
    expect(remaining + PENDING_TOKENS + COMPLETION_BUDGET).toBeLessThanOrEqual(
      marginAdjustedLimit,
    );
  });

  it('leaves history alone when the pending request already fits', async () => {
    const { enforcer, historyService } = await buildHarness();
    const historyTokens = historyService.getTotalTokens();

    await enforcer.enforce(1, 'prompt-3406-pending-fits', undefined);

    expect(historyService.getTotalTokens()).toBe(historyTokens);
  });
});
