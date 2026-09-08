/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for issue #3499: when the load-balancer context guard
 * invokes the provider compression callback, the enforcer must run the full
 * reduction ladder (density optimization, compression, ineffective retry,
 * deficit-exact history truncation, unified tool-response truncation) and,
 * when the guard supplies its estimate and limit, target
 * `guard.contextLimit - overhead` instead of its own budget-derived ceiling.
 *
 * The tests use the REAL ProviderContentEnforcer over a REAL HistoryService
 * with real token estimation, driving the REAL TopDownTruncationStrategy
 * through the real compression-context builder — the same wiring
 * CompressionHandler uses. Assertions are on returned contents and token
 * projections, never on mock interactions.
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  ProviderContentEnforcer,
  type ProviderContentEnforcementDeps,
} from '../providerContentEnforcement.js';
import { TopDownTruncationStrategy } from '../TopDownTruncationStrategy.js';
import { buildCompressionContext } from '../compressionContextBuilder.js';
import { computeMarginAdjustedLimit } from '../contextLimitPolicy.js';
import {
  buildRuntimeContext,
  buildMockContentGenerator,
} from '../../core/__tests__/chatSession-density-helpers.js';
import { ChatSession } from '../../core/chatSession.js';
import type { CompressionCallback } from '@vybestack/llxprt-code-providers';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';

const MODEL = 'test-model';
const HISTORY_MESSAGES = 14;
const MESSAGE_WORDS = 280;
// Simulated tool-schema/prompt overhead the contents-only estimator cannot
// see — the reason the guard's estimate exceeds the enforcer's own estimate.
const GUARD_OVERHEAD = 350;
const SESSION_CONTEXT_LIMIT = 200_000;

interface GuardInfo {
  estimatedTokens: number;
  contextLimit: number;
}

type GuardAwareCallback = (
  contents: IContent[],
  guard?: GuardInfo,
) => Promise<IContent[]>;

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

function resultText(contents: IContent[]): string {
  return contents
    .flatMap((content) => content.blocks)
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function seedHistory(historyService: HistoryService): void {
  for (let i = 0; i < HISTORY_MESSAGES; i++) {
    // Zero-padded markers keep substring assertions unambiguous.
    historyService.add(
      textContent(
        i % 2 === 0 ? 'human' : 'ai',
        `entry ${String(i).padStart(2, '0')} ${'word '.repeat(MESSAGE_WORDS)}`,
      ),
    );
  }
}

function makePending(): IContent {
  return textContent(
    'human',
    `pending-marker ${'word '.repeat(MESSAGE_WORDS)}`,
  );
}

/** Build guard facts whose estimate exceeds its limit by `excess` tokens. */
function guardOverBy(initialEstimate: number, excess: number): GuardInfo {
  return {
    estimatedTokens: initialEstimate + GUARD_OVERHEAD,
    contextLimit: initialEstimate + GUARD_OVERHEAD - excess,
  };
}

/** effectiveLimit the enforcer must satisfy: guard.contextLimit - overhead. */
function effectiveLimitFor(guard: GuardInfo): number {
  return guard.contextLimit - GUARD_OVERHEAD;
}

function expectCapturedCallback(
  callback: GuardAwareCallback | null,
): GuardAwareCallback {
  expect(callback).not.toBeNull();
  if (callback === null) {
    throw new Error('Expected compression callback to be captured');
  }
  return callback;
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

/**
 * Replace history with itself minus its oldest entry — a compression round
 * that under-delivers relative to a multi-message deficit.
 */
async function shedOldestMessage(
  historyService: HistoryService,
): Promise<void> {
  const original = [...historyService.getCurated()];
  historyService.clear();
  for (const entry of original.slice(1)) {
    historyService.add(entry);
  }
  await historyService.waitForTokenUpdates();
}

interface DirectHarness {
  enforcer: ProviderContentEnforcer;
  historyService: HistoryService;
  pending: IContent;
  contents: IContent[];
  initialEstimate: number;
}

async function buildDirectHarness(options: {
  contextLimit: number;
  compression?: 'noop' | 'underdeliver';
}): Promise<DirectHarness> {
  const historyService = new HistoryService();
  const runtimeContext = buildRuntimeContext(historyService, {
    contextLimit: options.contextLimit,
    compressionThreshold: 0.8,
  });
  const logger = makeLogger();
  seedHistory(historyService);
  await historyService.waitForTokenUpdates();
  const pending = makePending();
  const contents = historyService.getCuratedForProvider([pending]);
  const initialEstimate = await historyService.estimateTokensForContents(
    contents,
    MODEL,
  );

  let compressionCalls = 0;
  const deps: ProviderContentEnforcementDeps = {
    historyService,
    runtimeContext,
    generationConfig: {},
    providerRuntimeNullable: undefined,
    logger,
    ensureDensityOptimized: vi.fn().mockResolvedValue(undefined),
    performCompression: vi.fn(async () => {
      compressionCalls++;
      if (options.compression === 'underdeliver' && compressionCalls === 1) {
        await shedOldestMessage(historyService);
        return PerformCompressionResult.COMPRESSED;
      }
      return PerformCompressionResult.NOOP;
    }),
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
    contents,
    initialEstimate,
  };
}

describe('ProviderContentEnforcer compression-callback escalation (issue #3499)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T2: escalates past an under-delivering compression round and truncates history to the guard target', async () => {
    const historyService = new HistoryService();
    const runtimeContext = buildRuntimeContext(historyService, {
      contextLimit: SESSION_CONTEXT_LIMIT,
      compressionThreshold: 0.8,
    });
    seedHistory(historyService);
    const pending = makePending();
    const chat = new ChatSession(
      runtimeContext,
      buildMockContentGenerator(),
      {},
      [],
    );
    const handler = chat['compressionHandler'];

    let compressionCalls = 0;
    vi.spyOn(handler, 'performCompression').mockImplementation(async () => {
      compressionCalls++;
      if (compressionCalls === 1) {
        await shedOldestMessage(historyService);
        return PerformCompressionResult.COMPRESSED;
      }
      return PerformCompressionResult.NOOP;
    });

    let capturedCallback: GuardAwareCallback | null = null;
    const providerWithCallback = {
      name: 'load-balancer',
      generateChatCompletion: vi.fn(),
      setCompressionCallback: vi.fn((cb: CompressionCallback | null) => {
        if (cb !== null) {
          capturedCallback = cb;
        }
      }),
    };

    const contents = historyService.getCuratedForProvider([pending]);
    const initialEstimate = await historyService.estimateTokensForContents(
      contents,
      MODEL,
    );
    await handler.enforceProviderContents(
      { contents, pendingContents: [pending] },
      'prompt-3499',
      providerWithCallback as unknown as IProvider,
    );

    const callback = expectCapturedCallback(capturedCallback);
    const guard = guardOverBy(initialEstimate, 900);
    const result = await callback(contents, guard);

    const finalEstimate = await historyService.estimateTokensForContents(
      result,
      MODEL,
    );
    expect(finalEstimate).toBeLessThanOrEqual(effectiveLimitFor(guard));
    // Compression shed only entry 00; truncation had to remove more than
    // that for the payload to fit the guard target, while entry 03 onward
    // survives and the pending request is preserved.
    expect(resultText(result)).not.toContain('entry 00');
    expect(resultText(result)).not.toContain('entry 01');
    expect(resultText(result)).toContain('entry 03');
    expect(resultText(result)).toContain('pending-marker');
  });

  it('T3: returns fitting contents instead of throwing when compression is a structural no-op', async () => {
    const harness = await buildDirectHarness({
      contextLimit: SESSION_CONTEXT_LIMIT,
      compression: 'noop',
    });
    const guard = guardOverBy(harness.initialEstimate, 900);
    const historyTokensBefore = harness.historyService.getTotalTokens();

    const result = await harness.enforcer.compressAndRecompose(
      [harness.pending],
      'prompt-3499',
      guard,
    );

    const finalEstimate =
      await harness.historyService.estimateTokensForContents(result, MODEL);
    expect(finalEstimate).toBeLessThanOrEqual(effectiveLimitFor(guard));
    expect(harness.historyService.getTotalTokens()).toBeLessThan(
      historyTokensBefore,
    );
  });

  it('T3: throws the structured overflow error when even truncation cannot fit the guard limit', async () => {
    const harness = await buildDirectHarness({
      contextLimit: SESSION_CONTEXT_LIMIT,
      compression: 'noop',
    });
    const guard: GuardInfo = {
      estimatedTokens: harness.initialEstimate + GUARD_OVERHEAD,
      contextLimit: 40,
    };

    await expect(
      harness.enforcer.compressAndRecompose(
        [harness.pending],
        'prompt-3499',
        guard,
      ),
    ).rejects.toThrow(
      /Request still exceeds the safety-adjusted context limit/,
    );
  });

  it('T4: targets contextLimit minus overhead for a small deficit instead of over-cutting', async () => {
    const harness = await buildDirectHarness({
      contextLimit: SESSION_CONTEXT_LIMIT,
      compression: 'noop',
    });
    const guard = guardOverBy(harness.initialEstimate, 800);
    const historyTokensBefore = harness.historyService.getTotalTokens();

    const result = await harness.enforcer.compressAndRecompose(
      [harness.pending],
      'prompt-3499',
      guard,
    );

    const finalEstimate =
      await harness.historyService.estimateTokensForContents(result, MODEL);
    expect(finalEstimate).toBeLessThanOrEqual(effectiveLimitFor(guard));
    // A deficit-exact target removes roughly the deficit; a default
    // completion-budget ceiling (~limit/2) would land far below this floor.
    expect(finalEstimate).toBeGreaterThan(effectiveLimitFor(guard) - 800);
    expect(finalEstimate).toBeGreaterThan(guard.contextLimit / 2);
    expect(harness.historyService.getTotalTokens()).toBeLessThan(
      historyTokensBefore,
    );
  });

  it('T4: converges against the enforcer own limits when no guard info is supplied', async () => {
    const contextLimit = 6_000;
    const harness = await buildDirectHarness({
      contextLimit,
      compression: 'noop',
    });
    const historyTokensBefore = harness.historyService.getTotalTokens();
    const completionBudget = Math.min(65_536, Math.floor(contextLimit * 0.5));
    const marginAdjustedLimit = computeMarginAdjustedLimit(contextLimit);

    const result = await harness.enforcer.compressAndRecompose(
      [harness.pending],
      'prompt-3499',
    );

    const finalEstimate =
      await harness.historyService.estimateTokensForContents(result, MODEL);
    expect(finalEstimate + completionBudget).toBeLessThanOrEqual(
      marginAdjustedLimit,
    );
    expect(harness.historyService.getTotalTokens()).toBeLessThan(
      historyTokensBefore,
    );
    expect(resultText(result)).toContain('pending-marker');
  });

  it('T4: keeps an empty pending boundary a no-op regardless of guard facts', async () => {
    const harness = await buildDirectHarness({
      contextLimit: SESSION_CONTEXT_LIMIT,
      compression: 'noop',
    });
    const guard = guardOverBy(harness.initialEstimate, 900);

    const result = await harness.enforcer.compressAndRecompose(
      [],
      'prompt-3499',
      guard,
    );

    expect(result).toStrictEqual([]);
  });
});
