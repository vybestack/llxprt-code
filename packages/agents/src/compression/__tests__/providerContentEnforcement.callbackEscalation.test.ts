import { curatedHistoryForTest } from '@vybestack/llxprt-code-test-utils/core/curated-history-fixture.js';
/// <reference lib="esnext.array" />
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for issue #3499: when the load-balancer context guard
 * invokes the provider compression callback, the source ladder must run the full
 * reduction ladder (density optimization, compression, ineffective retry,
 * deficit-exact history truncation, unified tool-response truncation) and,
 * when the guard supplies its estimate and limit, target
 * `guard.contextLimit - overhead` instead of its own budget-derived ceiling.
 *
 * The tests drive a REAL CompressionHandler over a REAL HistoryService
 * with real token estimation, driving the REAL TopDownTruncationStrategy
 * through the handler's own disk fallback. Assertions are on returned contents and token
 * projections, never on mock interactions.
 */

import { describe, it, expect, vi } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { enforceProviderSourceForTest } from './support/enforce-provider-source.js';
import { buildHandlerHarness } from './support/handler-harness.js';
import { computeMarginAdjustedLimit } from '../contextLimitPolicy.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
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
  guard?: GuardInfo,
) => Promise<ProviderRequestSelection>;

async function readSelection(
  rows: ProviderRequestSelection,
): Promise<IContent[]> {
  const out: IContent[] = [];
  for await (const row of rows.openReader()) out.push(row);
  return out;
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
 * Replace history with itself minus its oldest entry — a compression round
 * that under-delivers relative to a multi-message deficit.
 */
async function shedOldestMessage(
  historyService: HistoryService,
): Promise<void> {
  const original = [...curatedHistoryForTest(historyService)];
  historyService.clear();
  for (const entry of original.slice(1)) {
    historyService.add(entry);
  }
  await historyService.waitForTokenUpdates();
}

interface GuardedHarness {
  historyService: HistoryService;
  callback: GuardAwareCallback;
  initialEstimate: number;
}

/**
 * Runs pre-send enforcement (which fits at this limit and leaves the provider
 * compression callback attached) and returns the captured callback, the way a
 * load-balancer guard would later invoke it.
 */
async function buildGuardedHarness(options: {
  compression: 'noop' | 'underdeliver';
}): Promise<GuardedHarness> {
  const historyService = new HistoryService();
  const runtimeContext = buildRuntimeContext(historyService, {
    contextLimit: SESSION_CONTEXT_LIMIT,
    compressionThreshold: 0.8,
  });
  seedHistory(historyService);
  await historyService.waitForTokenUpdates();
  const pending = makePending();
  const harness = buildHandlerHarness(historyService, runtimeContext, {
    realDiskFallback: true,
  });

  let compressionCalls = 0;
  harness.performCompression.mockImplementation(async () => {
    compressionCalls++;
    if (options.compression === 'underdeliver' && compressionCalls === 1) {
      await shedOldestMessage(historyService);
      return PerformCompressionResult.COMPRESSED;
    }
    return PerformCompressionResult.NOOP;
  });

  let capturedCallback: GuardAwareCallback | null = null;
  const provider = {
    name: 'load-balancer',
    generateChatCompletion: vi.fn(),
    setCompressionCallback: vi.fn((cb: CompressionCallback | null) => {
      if (cb !== null) capturedCallback = cb;
    }),
  };

  const initialRows = await Array.fromAsync(
    historyService.getCuratedForProviderStream([pending]),
  );
  const initialEstimate = await historyService.estimateTokensForContents(
    initialRows,
    MODEL,
  );
  await enforceProviderSourceForTest(
    harness.handler,
    historyService,
    [pending],
    'prompt-3499',
    provider as unknown as IProvider,
  );

  return {
    historyService,
    callback: expectCapturedCallback(capturedCallback),
    initialEstimate,
  };
}

describe('CompressionHandler compression-callback escalation (issue #3499)', () => {
  it('T2: escalates past an under-delivering compression round and truncates history to the guard target', async () => {
    const { historyService, callback, initialEstimate } =
      await buildGuardedHarness({ compression: 'underdeliver' });
    const guard = guardOverBy(initialEstimate, 900);

    const result = await readSelection(await callback(guard));

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
    const { historyService, callback, initialEstimate } =
      await buildGuardedHarness({ compression: 'noop' });
    const guard = guardOverBy(initialEstimate, 900);
    const historyTokensBefore = historyService.getTotalTokens();

    const result = await readSelection(await callback(guard));

    const finalEstimate = await historyService.estimateTokensForContents(
      result,
      MODEL,
    );
    expect(finalEstimate).toBeLessThanOrEqual(effectiveLimitFor(guard));
    expect(historyService.getTotalTokens()).toBeLessThan(historyTokensBefore);
  });

  it('T3: throws the structured overflow error when even truncation cannot fit the guard limit', async () => {
    const { callback, initialEstimate } = await buildGuardedHarness({
      compression: 'noop',
    });
    const guard: GuardInfo = {
      estimatedTokens: initialEstimate + GUARD_OVERHEAD,
      contextLimit: 40,
    };

    await expect(callback(guard)).rejects.toThrow(
      /Request still exceeds the safety-adjusted context limit/,
    );
  });

  it('T4: targets contextLimit minus overhead for a small deficit instead of over-cutting', async () => {
    const { historyService, callback, initialEstimate } =
      await buildGuardedHarness({ compression: 'noop' });
    const guard = guardOverBy(initialEstimate, 800);
    const historyTokensBefore = historyService.getTotalTokens();

    const result = await readSelection(await callback(guard));

    const finalEstimate = await historyService.estimateTokensForContents(
      result,
      MODEL,
    );
    expect(finalEstimate).toBeLessThanOrEqual(effectiveLimitFor(guard));
    // A deficit-exact target removes roughly the deficit; a default
    // completion-budget ceiling (~limit/2) would land far below this floor.
    expect(finalEstimate).toBeGreaterThan(effectiveLimitFor(guard) - 800);
    expect(finalEstimate).toBeGreaterThan(guard.contextLimit / 2);
    expect(historyService.getTotalTokens()).toBeLessThan(historyTokensBefore);
  });

  it('T4: converges against the handler own limits when no guard info is supplied', async () => {
    const contextLimit = 6_000;
    const historyService = new HistoryService();
    const runtimeContext = buildRuntimeContext(historyService, {
      contextLimit,
      compressionThreshold: 0.8,
    });
    seedHistory(historyService);
    await historyService.waitForTokenUpdates();
    const harness = buildHandlerHarness(historyService, runtimeContext, {
      realDiskFallback: true,
    });
    const historyTokensBefore = historyService.getTotalTokens();
    const completionBudget = Math.min(65_536, Math.floor(contextLimit * 0.5));
    const marginAdjustedLimit = computeMarginAdjustedLimit(contextLimit);

    const result = await enforceProviderSourceForTest(
      harness.handler,
      historyService,
      [makePending()],
      'prompt-3499',
      undefined,
    );

    const finalEstimate = await historyService.estimateTokensForContents(
      result,
      MODEL,
    );
    expect(finalEstimate + completionBudget).toBeLessThanOrEqual(
      marginAdjustedLimit,
    );
    expect(historyService.getTotalTokens()).toBeLessThan(historyTokensBefore);
    expect(resultText(result)).toContain('pending-marker');
  });
});
