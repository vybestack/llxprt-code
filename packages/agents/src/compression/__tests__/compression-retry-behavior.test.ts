/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260218-COMPRESSION-RETRY.P01
 * @requirement REQ-CR-003, REQ-CR-004
 *
 * Behavioral tests for ChatSession compression retry behavior and fallback
 * strategy usage. Extracted from the original monolithic
 * compression-retry.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { CompressionExecutionError } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { PerformCompressionResult } from '../../core/turn.js';
import {
  installSummaryTransport,
  failDiskFallbackEstimation,
  observeDiskFallback,
} from './compression-regression-fixtures.js';

import { ChatSession } from '../../core/chatSession.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  makeHttpError,
  makeAnthropicOverloadError,
  makeAnthropicSdkWrappedError,
  makeChatSession,
  installEmptySummaryDiskFailure,
} from './compression-retry-helpers.js';

// Mock the delay utility so retryWithBackoff doesn't actually wait in tests
void vi.mock('@vybestack/llxprt-code-core/utils/delay.js', () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  createAbortError: () => {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    return err;
  },
}));

// ---- Shared setup/assertion helpers for the Issue #2333 fallback tests ----

let restoreStrategyFactory: (() => void) | undefined;
let runtimeSetup: ReturnType<typeof createChatSessionRuntime>;
let providerRuntimeSnapshot: ProviderRuntimeContext;

function setupCompressionRuntime(): void {
  vi.clearAllMocks();
  runtimeSetup = createChatSessionRuntime();
  providerRuntimeSnapshot = {
    ...runtimeSetup.runtime,
    config: runtimeSetup.config,
  };
}

interface EmptySummaryFallbackSetup {
  chat: ChatSession;
  historyService: HistoryService;
  getFallbackCalled: () => boolean;
  getPrimaryCallCount: () => number;
  restore: () => void;
}

type EmptySummaryFallbackAssertions = Omit<
  EmptySummaryFallbackSetup,
  'chat' | 'restore'
>;

/**
 * Installs the empty-summary fallback factory mock and builds a ChatSession
 * with the shared historyService.add spy wired up, returning all the handles
 * the two Issue #2333 tests need. The distinct act step (performCompression
 * vs ensureCompressionBeforeSend) stays inline in each test.
 */
function setupEmptySummaryFallback(
  runtimeSetup: ReturnType<typeof createChatSessionRuntime>,
  providerRuntimeSnapshot: ProviderRuntimeContext,
): EmptySummaryFallbackSetup {
  const { getFallbackCalled, getPrimaryCallCount, restore } =
    installEmptySummaryDiskFailure(runtimeSetup.provider);

  const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot, [
    { speaker: 'human', blocks: [{ type: 'text', text: 'retained request' }] },
  ]);
  const historyService = chat.getHistoryService();

  return {
    chat,
    historyService,
    getFallbackCalled,
    getPrimaryCallCount,
    restore,
  };
}

/**
 * The shared assertions for the Issue #2333 fallback path: the truncation
 * fallback was used, the primary strategy ran once, and the fallback result
 * replaced the session history.
 */
async function expectEmptySummaryFallbackApplied({
  historyService,
  getFallbackCalled,
  getPrimaryCallCount,
}: EmptySummaryFallbackAssertions): Promise<void> {
  expect(getFallbackCalled()).toBe(true);
  expect(getPrimaryCallCount()).toBe(1);

  await collectRowsForAssertions(
    historyService.getComprehensive(),
    async (history) => {
      expect(history).toHaveLength(1);
      const [content] = history;
      expect(content.speaker).toBe('human');
      expect(content.blocks).toHaveLength(1);
      const [block] = content.blocks;
      expect(block.type).toBe('text');
      expect(block.type === 'text' ? block.text.length : 0).toBeGreaterThan(0);
    },
  );
}

// ---------------------------------------------------------------------------
// Phase 2: Retry behavior in performCompression
// ---------------------------------------------------------------------------

describe('ChatSession compression retry behavior @plan PLAN-20260218-COMPRESSION-RETRY.P01', () => {
  beforeEach(setupCompressionRuntime);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @requirement REQ-CR-003
   * performCompression retries on transient errors
   */
  it('retries a transient error and eventually succeeds', async () => {
    const { callCount } =
      await observeRetriesATransientErrorAndEventuallySucceeds();
    expect(callCount).toBe(3);
  });

  const observeRetriesATransientErrorAndEventuallySucceeds = async () => {
    const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

    let callCount = 0;
    installSummaryTransport(runtimeSetup.provider, async () => {
      callCount++;
      if (callCount < 3) throw makeHttpError(503);
      return '<state_snapshot>summary</state_snapshot>';
    });

    await chat.performCompression('test-prompt');

    return { callCount };
  };

  /**
   * @requirement REQ-CR-003
   * Issue #2045: performCompression retries an Anthropic overload error
   * (which carries no HTTP status) and eventually succeeds.
   */
  it('retries an Anthropic overloaded_error and eventually succeeds', async () => {
    const { callCount } =
      await observeRetriesAnAnthropicOverloadedErrorAndEventuallySucceeds();
    expect(callCount).toBe(3);
  });

  const observeRetriesAnAnthropicOverloadedErrorAndEventuallySucceeds =
    async () => {
      const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

      let callCount = 0;
      installSummaryTransport(runtimeSetup.provider, async () => {
        callCount++;
        if (callCount < 3) throw makeAnthropicOverloadError('overloaded_error');
        return '<state_snapshot>summary</state_snapshot>';
      });

      await chat.performCompression('test-prompt');

      return { callCount };
    };

  /**
   * @requirement REQ-CR-001
   * Issue #2053: performCompression retries an Anthropic api_error
   * (Internal server error) delivered in the real SDK-wrapped shape
   * (HTTP status undefined, retryable type nested at error.error.error.type)
   * and eventually succeeds instead of breaking compression.
   */
  it('retries an SDK-wrapped Anthropic api_error and eventually succeeds', async () => {
    const { callCount } =
      await observeRetriesAnSDKWrappedAnthropicApiErrorAndEventuallySucceeds();
    expect(callCount).toBe(3);
  });

  const observeRetriesAnSDKWrappedAnthropicApiErrorAndEventuallySucceeds =
    async () => {
      const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

      let callCount = 0;
      installSummaryTransport(runtimeSetup.provider, async () => {
        callCount++;
        if (callCount < 3)
          throw makeAnthropicSdkWrappedError(
            'api_error',
            'Internal server error',
          );
        return '<state_snapshot>summary</state_snapshot>';
      });

      await chat.performCompression('test-prompt');

      return { callCount };
    };

  /**
   * @requirement REQ-CR-003
   * performCompression fails fast on permanent errors (no retry)
   */
  it('does not retry permanent errors', async () => {
    const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

    let callCount = 0;
    installSummaryTransport(runtimeSetup.provider, async () => {
      callCount++;
      throw new CompressionExecutionError('middle-out', 'permanent failure');
    });

    await expect(chat.performCompression('test-prompt')).rejects.toThrow(
      CompressionExecutionError,
    );
    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 3: Fallback compression strategy
// ---------------------------------------------------------------------------

describe('ChatSession compression fallback @plan PLAN-20260218-COMPRESSION-RETRY.P01', () => {
  beforeEach(setupCompressionRuntime);

  afterEach(() => {
    restoreStrategyFactory?.();
    restoreStrategyFactory = undefined;
    vi.restoreAllMocks();
  });

  /**
   * @requirement REQ-CR-004
   * Falls back to TopDownTruncation when primary strategy fails
   */
  it('uses fallback strategy when primary strategy fails after retries', async () => {
    const { fallbackCalled, primaryCallCount } =
      await observeUsesFallbackStrategyWhenPrimaryStrategyFailsAfterRetries();
    expect(fallbackCalled).toBe(true);
    expect(primaryCallCount).toBeGreaterThan(0);
  });

  const observeUsesFallbackStrategyWhenPrimaryStrategyFailsAfterRetries =
    async () => {
      const chat = makeChatSession(runtimeSetup, providerRuntimeSnapshot);

      let fallbackCalled = false;
      let primaryCallCount = 0;

      const fallback = observeDiskFallback();
      installSummaryTransport(runtimeSetup.provider, async () => {
        primaryCallCount++;
        throw makeHttpError(500);
      });

      // performCompression internally catches and falls back
      await chat.performCompression('test-prompt');

      fallbackCalled = fallback.mock.calls.length > 0;
      return { fallbackCalled, primaryCallCount };
    };

  /**
   * @requirement REQ-CR-004
   * When fallback also fails, logs error and continues without throwing
   */
  it('does not throw when fallback also fails', async () => {
    const chat: ChatSession = makeChatSession(
      runtimeSetup,
      providerRuntimeSnapshot,
    );

    installSummaryTransport(runtimeSetup.provider, async () => {
      throw makeHttpError(500);
    });
    failDiskFallbackEstimation(chat.getHistoryService(), () =>
      makeHttpError(500),
    );

    // When both primary and fallback fail, should not throw and should return FAILED
    await expect(chat.performCompression('test-prompt')).resolves.toBe(
      PerformCompressionResult.FAILED,
    );
  });

  /**
   * @requirement REQ-CR-004
   * Issue #2333: When the primary strategy deterministically returns an empty
   * summary (EmptySummaryError), the turn must not abort. Instead it should
   * fall back to the non-LLM top-down-truncation strategy without retrying
   * the empty summary.
   */
  it('falls back to truncation when primary strategy returns an empty summary', async () => {
    const {
      chat,
      historyService,
      getFallbackCalled,
      getPrimaryCallCount,
      restore,
    } = setupEmptySummaryFallback(runtimeSetup, providerRuntimeSnapshot);
    restoreStrategyFactory = restore;

    // performCompression should resolve (COMPRESSED) via fallback, not reject
    await expect(chat.performCompression('test-prompt')).resolves.toBe(
      PerformCompressionResult.COMPRESSED,
    );

    await expectEmptySummaryFallbackApplied({
      historyService,
      getFallbackCalled,
      getPrimaryCallCount,
    });
  });

  /**
   * @requirement REQ-CR-004
   * Issue #2333: The threshold-triggered auto-compression path exercised at
   * send time — `ChatSession.ensureCompressionBeforeSend(...)` — must not
   * reject when the primary (middle-out) strategy throws an
   * EmptySummaryError. This is the exact user-facing failure mode from the
   * issue: an empty summary from the primary strategy aborted the turn with a
   * surfaced "[API Error: Compression strategy "middle-out" produced an empty
   * summary]" message. Instead the turn should complete via the non-LLM
   * top-down-truncation fallback without retrying the empty summary.
   */
  it('ensureCompressionBeforeSend does not reject on EmptySummaryError and applies the truncation fallback', async () => {
    const {
      chat,
      historyService,
      getFallbackCalled,
      getPrimaryCallCount,
      restore,
    } = setupEmptySummaryFallback(runtimeSetup, providerRuntimeSnapshot);
    restoreStrategyFactory = restore;

    // The threshold-triggered auto-compression path must resolve (not reject)
    // and apply the truncation fallback.
    await expect(
      chat.ensureCompressionBeforeSend('test-prompt', 0, 'send'),
    ).resolves.toBeUndefined();

    await expectEmptySummaryFallbackApplied({
      historyService,
      getFallbackCalled,
      getPrimaryCallCount,
    });
  });
});
