/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260218-COMPRESSION-RETRY.P01
 * @requirement REQ-CR-001, REQ-CR-002, REQ-CR-003, REQ-CR-004, REQ-CR-005
 *
 * Behavioral tests for compression retry logic and fallback mechanisms.
 * Tests verify error classification, retry behavior, fallback strategy usage,
 * and cooldown logic introduced in issue #1210.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
  isTransientCompressionError,
  shouldRetryCompressionError,
  CompressionExecutionError,
  CompressionStrategyError,
  UnknownStrategyError,
  PromptResolutionError,
} from '../types.js';
import { PerformCompressionResult } from '../../turn.js';
import * as compressionFactory from '../compressionStrategyFactory.js';
import { GeminiChat } from '../../geminiChat.js';
import { createGeminiChatRuntime } from '../../../test-utils/runtime.js';
import { createAgentRuntimeState } from '../../../runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '../../../runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '../../../runtime/runtimeAdapters.js';
import { HistoryService } from '../../../services/history/HistoryService.js';
import * as providerRuntime from '../../../runtime/providerRuntimeContext.js';
import type { ProviderRuntimeContext } from '../../../runtime/providerRuntimeContext.js';

// Mock the delay utility so retryWithBackoff doesn't actually wait in tests
vi.mock('../../../utils/delay.js', () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  createAbortError: () => {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    return err;
  },
}));

// ---------------------------------------------------------------------------
// Helper error factories
// ---------------------------------------------------------------------------

function makeHttpError(status: number): Error {
  const err = new Error(`HTTP error ${status}`);
  (err as { status?: number }).status = status;
  return err;
}

function makeNetworkError(code: string): Error {
  const err = new Error(`Network error: ${code}`);
  (err as { code?: string }).code = code;
  return err;
}

// ---------------------------------------------------------------------------
// Phase 1: isTransientCompressionError
// ---------------------------------------------------------------------------

describe('isTransientCompressionError @plan PLAN-20260218-COMPRESSION-RETRY.P01', () => {
  /**
   * @requirement REQ-CR-001
   * HTTP 429 is transient
   */
  it('returns true for HTTP 429 rate limit error', () => {
    expect(isTransientCompressionError(makeHttpError(429))).toBe(true);
  });

  /**
   * @requirement REQ-CR-001
   * HTTP 500-599 are transient server errors
   */
  it('returns true for HTTP 500 server error', () => {
    expect(isTransientCompressionError(makeHttpError(500))).toBe(true);
  });

  it('returns true for HTTP 503 service unavailable', () => {
    expect(isTransientCompressionError(makeHttpError(503))).toBe(true);
  });

  it('returns true for HTTP 502 bad gateway', () => {
    expect(isTransientCompressionError(makeHttpError(502))).toBe(true);
  });

  /**
   * @requirement REQ-CR-001
   * Network errors are transient
   */
  it('returns true for ECONNRESET network error', () => {
    expect(isTransientCompressionError(makeNetworkError('ECONNRESET'))).toBe(
      true,
    );
  });

  it('returns true for ETIMEDOUT network error', () => {
    expect(isTransientCompressionError(makeNetworkError('ETIMEDOUT'))).toBe(
      true,
    );
  });

  it('returns true for error with "connection reset" message', () => {
    const err = new Error('connection reset by peer');
    expect(isTransientCompressionError(err)).toBe(true);
  });

  it('returns true for error with "network timeout" message', () => {
    const err = new Error('network timeout');
    expect(isTransientCompressionError(err)).toBe(true);
  });

  /**
   * @requirement REQ-CR-001
   * Permanent errors classified correctly
   */
  it('returns false for COMPRESSION_FAILED_INFLATED_TOKEN_COUNT (permanent)', () => {
    const err = new CompressionStrategyError(
      'Compression inflated token count',
      'COMPRESSION_FAILED_INFLATED_TOKEN_COUNT',
    );
    expect(isTransientCompressionError(err)).toBe(false);
  });

  it('returns false for CompressionExecutionError with EXECUTION_FAILED code (permanent)', () => {
    const err = new CompressionExecutionError('middle-out', 'some failure');
    expect(isTransientCompressionError(err)).toBe(false);
  });

  it('returns false for PromptResolutionError (permanent)', () => {
    const err = new PromptResolutionError('compress-prompt');
    expect(isTransientCompressionError(err)).toBe(false);
  });

  it('returns false for UnknownStrategyError (permanent)', () => {
    const err = new UnknownStrategyError('nonexistent-strategy');
    expect(isTransientCompressionError(err)).toBe(false);
  });

  it('returns false for HTTP 400 bad request (permanent)', () => {
    expect(isTransientCompressionError(makeHttpError(400))).toBe(false);
  });

  it('returns false for HTTP 401 unauthorized (permanent)', () => {
    expect(isTransientCompressionError(makeHttpError(401))).toBe(false);
  });

  it('returns false for generic programming error (permanent)', () => {
    const err = new TypeError('Cannot read property of undefined');
    expect(isTransientCompressionError(err)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isTransientCompressionError(null)).toBe(false);
  });

  it('returns false for string error', () => {
    expect(isTransientCompressionError('some error message')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 1: shouldRetryCompressionError
// ---------------------------------------------------------------------------

describe('shouldRetryCompressionError @plan PLAN-20260218-COMPRESSION-RETRY.P01', () => {
  /**
   * @requirement REQ-CR-002
   * Should retry transient errors
   */
  it('returns true for HTTP 429', () => {
    expect(shouldRetryCompressionError(makeHttpError(429))).toBe(true);
  });

  it('returns true for HTTP 500', () => {
    expect(shouldRetryCompressionError(makeHttpError(500))).toBe(true);
  });

  it('returns true for ECONNRESET', () => {
    expect(shouldRetryCompressionError(makeNetworkError('ECONNRESET'))).toBe(
      true,
    );
  });

  /**
   * @requirement REQ-CR-002
   * Should not retry permanent errors
   */
  it('returns false for CompressionExecutionError', () => {
    const err = new CompressionExecutionError(
      'middle-out',
      'permanent failure',
    );
    expect(shouldRetryCompressionError(err)).toBe(false);
  });

  it('returns false for PromptResolutionError', () => {
    const err = new PromptResolutionError('prompt-id');
    expect(shouldRetryCompressionError(err)).toBe(false);
  });

  it('returns false for UnknownStrategyError', () => {
    const err = new UnknownStrategyError('bad-strategy');
    expect(shouldRetryCompressionError(err)).toBe(false);
  });

  it('returns false for HTTP 400', () => {
    expect(shouldRetryCompressionError(makeHttpError(400))).toBe(false);
  });

  it('returns true for CompressionExecutionError with isTransient: true', () => {
    const err = new CompressionExecutionError('middle-out', 'empty summary', {
      isTransient: true,
    });
    expect(shouldRetryCompressionError(err)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 1: CompressionExecutionError.isTransient property
// ---------------------------------------------------------------------------

describe('CompressionExecutionError.isTransient @plan PLAN-20260218-COMPRESSION-RETRY.P01', () => {
  /**
   * @requirement REQ-CR-001
   * isTransient property reflects transience classification
   */
  it('has isTransient: false by default (permanent execution failure)', () => {
    const err = new CompressionExecutionError('middle-out', 'failed');
    expect(err.isTransient).toBe(false);
  });

  it('has isTransient: true when explicitly set', () => {
    const err = new CompressionExecutionError('middle-out', 'rate limited', {
      isTransient: true,
    });
    expect(err.isTransient).toBe(true);
  });

  it('has isTransient: false when explicitly set to false', () => {
    const err = new CompressionExecutionError('middle-out', 'auth error', {
      isTransient: false,
    });
    expect(err.isTransient).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property-based tests (≥ 30% of total tests)
// ---------------------------------------------------------------------------

describe('Property-based: error classification @plan PLAN-20260218-COMPRESSION-RETRY.P01', () => {
  /**
   * @requirement REQ-CR-001
   * 5xx status codes are always transient
   */
  it('all 5xx status codes are transient', () => {
    fc.assert(
      fc.property(fc.integer({ min: 500, max: 599 }), (status) => {
        expect(isTransientCompressionError(makeHttpError(status))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * @requirement REQ-CR-001
   * 4xx (except 429) are permanent
   */
  it('4xx status codes except 429 are not transient', () => {
    fc.assert(
      fc.property(fc.integer({ min: 400, max: 428 }), (status) => {
        expect(isTransientCompressionError(makeHttpError(status))).toBe(false);
      }),
      { numRuns: 29 },
    );
  });

  it('4xx status codes 430-499 are not transient', () => {
    fc.assert(
      fc.property(fc.integer({ min: 430, max: 499 }), (status) => {
        expect(isTransientCompressionError(makeHttpError(status))).toBe(false);
      }),
      { numRuns: 70 },
    );
  });

  /**
   * @requirement REQ-CR-002
   * shouldRetry mirrors isTransient for all error types
   */
  it('shouldRetryCompressionError returns same as isTransientCompressionError', () => {
    fc.assert(
      fc.property(fc.integer({ min: 400, max: 599 }), (status) => {
        const err = makeHttpError(status);
        expect(shouldRetryCompressionError(err)).toBe(
          isTransientCompressionError(err),
        );
      }),
      { numRuns: 200 },
    );
  });

  /**
   * @requirement REQ-CR-001
   * CompressionStrategyError subclasses are never transient
   */
  it('CompressionStrategyError subclasses are always non-transient', () => {
    const permanentErrors = [
      new CompressionExecutionError('s', 'cause'),
      new PromptResolutionError('pid'),
      new UnknownStrategyError('bad'),
      new CompressionStrategyError('msg', 'EXECUTION_FAILED'),
      new CompressionStrategyError('msg', 'PROMPT_RESOLUTION_FAILED'),
      new CompressionStrategyError('msg', 'UNKNOWN_STRATEGY'),
      new CompressionStrategyError(
        'msg',
        'COMPRESSION_FAILED_INFLATED_TOKEN_COUNT',
      ),
    ];

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: permanentErrors.length - 1 }),
        (idx) => {
          expect(isTransientCompressionError(permanentErrors[idx])).toBe(false);
          expect(shouldRetryCompressionError(permanentErrors[idx])).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// GeminiChat integration tests for retry/fallback/cooldown
// ---------------------------------------------------------------------------

/**
 * Creates a minimal GeminiChat instance for compression behavior testing.
 * Uses vi.spyOn on getCompressionStrategy to control compression outcomes.
 */
function makeGeminiChat(
  runtimeSetup: ReturnType<typeof createGeminiChatRuntime>,
  providerRuntimeSnapshot: ProviderRuntimeContext,
): GeminiChat {
  const runtimeState = createAgentRuntimeState({
    runtimeId: runtimeSetup.runtime.runtimeId,
    provider: runtimeSetup.provider.name,
    model: 'test-model',
    sessionId: 'test-session-id',
  });

  const historyService = new HistoryService();
  vi.spyOn(historyService, 'getTotalTokens').mockReturnValue(100000);
  vi.spyOn(historyService, 'waitForTokenUpdates').mockResolvedValue(undefined);
  vi.spyOn(historyService, 'getStatistics').mockReturnValue({
    totalMessages: 10,
    humanMessages: 5,
    aiMessages: 5,
  });
  vi.spyOn(historyService, 'startCompression').mockImplementation(() => {});
  vi.spyOn(historyService, 'endCompression').mockImplementation(() => {});
  vi.spyOn(historyService, 'getCurated').mockReturnValue([
    { role: 'user', parts: [{ text: 'hello' }] },
    { role: 'model', parts: [{ text: 'hi' }] },
  ]);
  vi.spyOn(historyService, 'clear').mockImplementation(() => {});
  vi.spyOn(historyService, 'add').mockImplementation(() => {});
  vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(0);

  const view = createAgentRuntimeContext({
    state: runtimeState,
    history: historyService,
    settings: {
      compressionThreshold: 0.5, // Low threshold so shouldCompress() returns true
      contextLimit: 200000,
      preserveThreshold: 0.2,
      telemetry: {
        enabled: false,
        target: null,
      },
    },
    provider: createProviderAdapterFromManager(
      runtimeSetup.config.getProviderManager?.(),
    ),
    telemetry: createTelemetryAdapterFromConfig(runtimeSetup.config),
    tools: createToolRegistryViewFromRegistry(
      runtimeSetup.config.getToolRegistry?.(),
    ),
    providerRuntime: providerRuntimeSnapshot,
  });

  const mockContentGenerator = {
    generateContent: vi.fn(),
    generateContentStream: vi.fn(),
    countTokens: vi.fn().mockReturnValue(100),
    embedContent: vi.fn(),
  };

  return new GeminiChat(view, mockContentGenerator, {}, []);
}

// ---------------------------------------------------------------------------
// Phase 2: Retry behavior in performCompression
// ---------------------------------------------------------------------------

describe('GeminiChat compression retry behavior @plan PLAN-20260218-COMPRESSION-RETRY.P01', () => {
  let runtimeSetup: ReturnType<typeof createGeminiChatRuntime>;
  let providerRuntimeSnapshot: ProviderRuntimeContext;

  beforeEach(() => {
    vi.clearAllMocks();
    runtimeSetup = createGeminiChatRuntime();
    providerRuntimeSnapshot = {
      ...runtimeSetup.runtime,
      config: runtimeSetup.config,
    };
    providerRuntime.setActiveProviderRuntimeContext(providerRuntimeSnapshot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @requirement REQ-CR-003
   * performCompression retries on transient errors
   */
  it('retries a transient error and eventually succeeds', async () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    let callCount = 0;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount < 3) {
            throw makeHttpError(503);
          }
          return {
            newHistory: [],
            metadata: {
              originalMessageCount: 10,
              compressedMessageCount: 5,
              strategyUsed: 'middle-out' as const,
              llmCallMade: true,
            },
          };
        }),
      }),
    );

    await chat.performCompression('test-prompt');
    expect(callCount).toBe(3);
  });

  /**
   * @requirement REQ-CR-003
   * performCompression fails fast on permanent errors (no retry)
   */
  it('does not retry permanent errors', async () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    let callCount = 0;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          callCount++;
          throw new CompressionExecutionError(
            'middle-out',
            'permanent failure',
          );
        }),
      }),
    );

    await expect(chat.performCompression('test-prompt')).rejects.toThrow(
      CompressionExecutionError,
    );
    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 3: Fallback compression strategy
// ---------------------------------------------------------------------------

describe('GeminiChat compression fallback @plan PLAN-20260218-COMPRESSION-RETRY.P01', () => {
  let runtimeSetup: ReturnType<typeof createGeminiChatRuntime>;
  let providerRuntimeSnapshot: ProviderRuntimeContext;

  beforeEach(() => {
    vi.clearAllMocks();
    runtimeSetup = createGeminiChatRuntime();
    providerRuntimeSnapshot = {
      ...runtimeSetup.runtime,
      config: runtimeSetup.config,
    };
    providerRuntime.setActiveProviderRuntimeContext(providerRuntimeSnapshot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @requirement REQ-CR-004
   * Falls back to TopDownTruncation when primary strategy fails
   */
  it('uses fallback strategy when primary strategy fails after retries', async () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    let fallbackCalled = false;
    let primaryCallCount = 0;

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      (name) => {
        if (name === 'top-down-truncation') {
          fallbackCalled = true;
          return {
            name: 'top-down-truncation' as const,
            requiresLLM: false,
            trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
            compress: vi.fn().mockResolvedValue({
              newHistory: [],
              metadata: {
                originalMessageCount: 10,
                compressedMessageCount: 5,
                strategyUsed: 'top-down-truncation' as const,
                llmCallMade: false,
              },
            }),
          };
        }
        return {
          name: 'middle-out' as const,
          requiresLLM: true,
          trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
          compress: vi.fn().mockImplementation(async () => {
            primaryCallCount++;
            throw makeHttpError(500);
          }),
        };
      },
    );

    // performCompression internally catches and falls back
    await chat.performCompression('test-prompt');
    expect(fallbackCalled).toBe(true);
    expect(primaryCallCount).toBeGreaterThan(0);
  });

  /**
   * @requirement REQ-CR-004
   * When fallback also fails, logs error and continues without throwing
   */
  it('does not throw when fallback also fails', async () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockRejectedValue(makeHttpError(500)),
      }),
    );

    // When both primary and fallback fail, should not throw and should return FAILED
    await expect(chat.performCompression('test-prompt')).resolves.toBe(
      PerformCompressionResult.FAILED,
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 4: Failure tracking and cooldown
// ---------------------------------------------------------------------------

describe('GeminiChat compression cooldown @plan PLAN-20260218-COMPRESSION-RETRY.P01', () => {
  let runtimeSetup: ReturnType<typeof createGeminiChatRuntime>;
  let providerRuntimeSnapshot: ProviderRuntimeContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    runtimeSetup = createGeminiChatRuntime();
    providerRuntimeSnapshot = {
      ...runtimeSetup.runtime,
      config: runtimeSetup.config,
    };
    providerRuntime.setActiveProviderRuntimeContext(providerRuntimeSnapshot);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * @requirement REQ-CR-005
   * After 3 failures within 60 seconds, compression is skipped
   */
  it('skips compression after 3 consecutive failures within cooldown period', async () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    let compressionAttempts = 0;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          compressionAttempts++;
          throw makeHttpError(500);
        }),
      }),
    );

    // Force 3 compressions to trigger cooldown
    await chat.performCompression('test-prompt'); // attempt 1 (fails)
    await chat.performCompression('test-prompt'); // attempt 2 (fails)
    await chat.performCompression('test-prompt'); // attempt 3 (fails)

    const attemptsAfter3 = compressionAttempts;

    // 4th call should be skipped due to cooldown
    await chat.performCompression('test-prompt');
    // Should not have increased the counter (skipped)
    expect(compressionAttempts).toBe(attemptsAfter3);
  });

  /**
   * @requirement REQ-CR-005
   * Cooldown expires after 60 seconds
   */
  it('cooldown expires after 60 seconds allowing compression to resume', async () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    let compressionAttempts = 0;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          compressionAttempts++;
          throw makeHttpError(500);
        }),
      }),
    );

    // Trigger 3 failures to enter cooldown
    await chat.performCompression('test-prompt');
    await chat.performCompression('test-prompt');
    await chat.performCompression('test-prompt');

    const countAfterCooldown = compressionAttempts;

    // Advance time past cooldown period (60 seconds)
    vi.advanceTimersByTime(61000);

    // Should attempt compression again after cooldown expires
    await chat.performCompression('test-prompt');
    expect(compressionAttempts).toBeGreaterThan(countAfterCooldown);
  });

  /**
   * @requirement REQ-CR-005
   * Cooldown resets on successful compression
   */
  it('resets failure count after successful compression', async () => {
    const chat = makeGeminiChat(runtimeSetup, providerRuntimeSnapshot);

    let shouldFail = true;
    let compressionAttempts = 0;

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          compressionAttempts++;
          if (shouldFail) {
            throw makeHttpError(500);
          }
          return {
            newHistory: [],
            metadata: {
              originalMessageCount: 10,
              compressedMessageCount: 5,
              strategyUsed: 'middle-out' as const,
              llmCallMade: true,
            },
          };
        }),
      }),
    );

    // Cause 2 failures (not yet at cooldown threshold)
    await chat.performCompression('test-prompt');
    await chat.performCompression('test-prompt');

    // Succeed once — should reset counter
    shouldFail = false;
    await chat.performCompression('test-prompt');

    // Now fail again — need 3 more failures to reach cooldown
    shouldFail = true;
    const countBeforeNewFailures = compressionAttempts;

    await chat.performCompression('test-prompt'); // failure 1
    await chat.performCompression('test-prompt'); // failure 2
    await chat.performCompression('test-prompt'); // failure 3 → cooldown

    const countAtCooldown = compressionAttempts;

    // 4th failure after reset should be skipped (cooldown active)
    await chat.performCompression('test-prompt');
    expect(compressionAttempts).toBe(countAtCooldown);
    expect(compressionAttempts).toBeGreaterThan(countBeforeNewFailures);
  });
});

// ---------------------------------------------------------------------------
// Phase 5: Hard-limit compression bypass (Issue #1791)
// ---------------------------------------------------------------------------

describe('Hard-limit compression behavior (Issue #1791)', () => {
  let runtimeSetup: ReturnType<typeof createGeminiChatRuntime>;
  let providerRuntimeSnapshot: ProviderRuntimeContext;

  beforeEach(() => {
    vi.clearAllMocks();
    runtimeSetup = createGeminiChatRuntime();
    providerRuntimeSnapshot = {
      ...runtimeSetup.runtime,
      config: runtimeSetup.config,
    };
    providerRuntime.setActiveProviderRuntimeContext(providerRuntimeSnapshot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Helper: build a GeminiChat with mocked history for enforceContextWindow tests.
   * The token counts are controlled so projected > marginAdjustedLimit.
   */
  function makeChatForEnforceContextWindow(overrides?: {
    totalTokens?: number;
    contextLimit?: number;
    maxOutputTokens?: number;
  }): GeminiChat {
    const totalTokens = overrides?.totalTokens ?? 100000;
    const contextLimit = overrides?.contextLimit ?? 200000;
    const maxOutputTokens = overrides?.maxOutputTokens ?? 65_536;

    const runtimeState = createAgentRuntimeState({
      runtimeId: runtimeSetup.runtime.runtimeId,
      provider: runtimeSetup.provider.name,
      model: 'test-model',
      sessionId: 'test-session-id',
    });

    const historyService = new HistoryService();
    vi.spyOn(historyService, 'getTotalTokens').mockReturnValue(totalTokens);
    vi.spyOn(historyService, 'waitForTokenUpdates').mockResolvedValue(
      undefined,
    );
    vi.spyOn(historyService, 'getStatistics').mockReturnValue({
      totalMessages: 10,
      humanMessages: 5,
      aiMessages: 5,
    });
    vi.spyOn(historyService, 'startCompression').mockImplementation(() => {});
    vi.spyOn(historyService, 'endCompression').mockImplementation(() => {});
    vi.spyOn(historyService, 'getCurated').mockReturnValue([
      { role: 'user', parts: [{ text: 'hello' }] },
      { role: 'model', parts: [{ text: 'hi' }] },
    ]);
    vi.spyOn(historyService, 'getRawHistory').mockReturnValue([]);
    vi.spyOn(historyService, 'applyDensityResult').mockResolvedValue(undefined);
    vi.spyOn(historyService, 'clear').mockImplementation(() => {});
    vi.spyOn(historyService, 'add').mockImplementation(() => {});
    vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(0);

    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.5,
        contextLimit,
        preserveThreshold: 0.2,
        telemetry: {
          enabled: false,
          target: null,
        },
      },
      provider: createProviderAdapterFromManager(
        runtimeSetup.config.getProviderManager?.(),
      ),
      telemetry: createTelemetryAdapterFromConfig(runtimeSetup.config),
      tools: createToolRegistryViewFromRegistry(
        runtimeSetup.config.getToolRegistry?.(),
      ),
      providerRuntime: providerRuntimeSnapshot,
    });

    const mockContentGenerator = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      embedContent: vi.fn(),
    };

    return new GeminiChat(view, mockContentGenerator, { maxOutputTokens }, []);
  }

  /**
   * @requirement REQ-1791.1
   * enforceContextWindow bypasses cooldown and still attempts compression.
   */
  it('bypasses cooldown when enforcing hard context window limit', async () => {
    vi.useFakeTimers();
    // Set totalTokens high enough that projected > marginAdjustedLimit
    // marginAdjustedLimit = 200000 - 1000 = 199000
    // projected = totalTokens + pendingTokens + completionBudget
    // With totalTokens=100000, pendingTokens=50000, completionBudget=65536 => 215536 > 199000
    const chat = makeChatForEnforceContextWindow({ totalTokens: 100_000 });

    // Put the chat into cooldown by forcing 3 compression failures
    let primaryAttempts = 0;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          primaryAttempts++;
          throw makeHttpError(500);
        }),
      }),
    );

    // Trigger cooldown: 3 failures via performCompression
    await chat.performCompression('test-prompt'); // failure 1
    await chat.performCompression('test-prompt'); // failure 2
    await chat.performCompression('test-prompt'); // failure 3 → cooldown

    const attemptsBeforeCooldown = primaryAttempts;

    // 4th performCompression should be skipped (cooldown active)
    await chat.performCompression('test-prompt');
    expect(primaryAttempts).toBe(attemptsBeforeCooldown);

    // Now make compression succeed so enforceContextWindow can get past it
    const succeedAfter = primaryAttempts;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          primaryAttempts++;
          if (primaryAttempts <= succeedAfter) {
            throw makeHttpError(500);
          }
          return {
            newHistory: [],
            metadata: {
              originalMessageCount: 10,
              compressedMessageCount: 0,
              strategyUsed: 'middle-out' as const,
              llmCallMade: true,
            },
          };
        }),
      }),
    );

    // Mock getTotalTokens to return a low value after a few calls
    // (simulating compression having succeeded)
    let tokenCallCount = 0;
    vi.spyOn(chat['historyService'], 'getTotalTokens').mockImplementation(
      () => {
        tokenCallCount++;
        // After the initial checks, return low tokens
        if (tokenCallCount > 3) {
          return 10_000; // Well under limit
        }
        return 100_000;
      },
    );

    // enforceContextWindow should bypass cooldown and attempt compression
    await chat['enforceContextWindow'](50_000, 'test-prompt');

    // Compression should have been attempted despite cooldown
    expect(primaryAttempts).toBeGreaterThan(attemptsBeforeCooldown);
    vi.useRealTimers();
  });

  /**
   * @requirement REQ-1791.2
   * When primary compression barely reduces tokens, fallback truncation is triggered.
   */
  it('forces fallback truncation when compression barely reduces tokens', async () => {
    // totalTokens=150000, pendingTokens=50000, completionBudget=65536
    // projected = 150000 + 50000 + 65536 = 265536 > 199000
    const chat = makeChatForEnforceContextWindow({ totalTokens: 150_000 });

    let truncationCalled = false;
    let primaryCallCount = 0;

    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      (name) => {
        if (name === 'top-down-truncation') {
          truncationCalled = true;
          return {
            name: 'top-down-truncation' as const,
            requiresLLM: false,
            trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
            compress: vi.fn().mockResolvedValue({
              newHistory: [],
              metadata: {
                originalMessageCount: 10,
                compressedMessageCount: 2,
                strategyUsed: 'top-down-truncation' as const,
                llmCallMade: false,
              },
            }),
          };
        }
        return {
          name: 'middle-out' as const,
          requiresLLM: true,
          trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
          compress: vi.fn().mockImplementation(async () => {
            primaryCallCount++;
            // Primary succeeds but barely reduces tokens (returns same history)
            return {
              newHistory: [
                { role: 'user', parts: [{ text: 'hello' }] },
                { role: 'model', parts: [{ text: 'hi' }] },
              ],
              metadata: {
                originalMessageCount: 10,
                compressedMessageCount: 9, // Barely reduced
                strategyUsed: 'middle-out' as const,
                llmCallMade: true,
              },
            };
          }),
        };
      },
    );

    // Mock getTotalTokens to stay high even after "compression"
    // so the fallback is triggered
    vi.spyOn(chat['historyService'], 'getTotalTokens').mockReturnValue(150_000);

    // enforceContextWindow should detect ineffective compression and force fallback
    try {
      await chat['enforceContextWindow'](50_000, 'test-prompt');
    } catch {
      // May still throw if tokens remain over limit, but truncation should have been called
    }

    expect(truncationCalled).toBe(true);
    expect(primaryCallCount).toBeGreaterThan(0);
  });

  /**
   * @requirement REQ-1791.6
   * Hard-limit fallback rewrite clears stale API prompt baseline.
   */
  it('clears lastPromptTokenCount when forceTruncationIfIneffective rewrites history', async () => {
    const chat = makeChatForEnforceContextWindow({
      totalTokens: 150_000,
      contextLimit: 200_000,
      maxOutputTokens: 65_536,
    });

    (
      chat as unknown as {
        compressionHandler: { lastPromptTokenCount: number | null };
      }
    ).compressionHandler.lastPromptTokenCount = 95_000;

    let fallbackApplied = false;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      (name) => {
        if (name === 'top-down-truncation') {
          return {
            name: 'top-down-truncation' as const,
            requiresLLM: false,
            trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
            compress: vi.fn().mockImplementation(async () => {
              fallbackApplied = true;
              return {
                newHistory: [{ role: 'user', parts: [{ text: 'truncated' }] }],
                metadata: {
                  originalMessageCount: 10,
                  compressedMessageCount: 2,
                  strategyUsed: 'top-down-truncation' as const,
                  llmCallMade: false,
                },
              };
            }),
          };
        }

        return {
          name: 'middle-out' as const,
          requiresLLM: true,
          trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
          compress: vi.fn().mockResolvedValue({
            // Ineffective primary compression triggers forceTruncationIfIneffective.
            newHistory: [
              { role: 'user', parts: [{ text: 'hello' }] },
              { role: 'model', parts: [{ text: 'hi' }] },
            ],
            metadata: {
              originalMessageCount: 10,
              compressedMessageCount: 9,
              strategyUsed: 'middle-out' as const,
              llmCallMade: true,
            },
          }),
        };
      },
    );

    vi.spyOn(chat['historyService'], 'getTotalTokens').mockReturnValue(150_000);

    await expect(
      chat['enforceContextWindow'](50_000, 'test-prompt'),
    ).rejects.toThrow(Error);

    expect(fallbackApplied).toBe(true);
    expect(
      (
        chat as unknown as {
          compressionHandler: { lastPromptTokenCount: number | null };
        }
      ).compressionHandler.lastPromptTokenCount,
    ).toBeNull();
  });

  /**
   * @requirement REQ-1791.5
   * Hard-limit gate uses API-observed prompt baseline when available.
   */
  it('uses lastPromptTokenCount in hard-limit gate projection when available', async () => {
    const chat = makeChatForEnforceContextWindow({
      totalTokens: 1_000,
      contextLimit: 100_000,
      maxOutputTokens: 10_000,
    });

    // If hard-limit gate used raw history (1,000), projection would be:
    // 1,000 + 10,000 + 10,000 = 21,000 <= 99,000 and compression would not run.
    // With API-observed baseline (95,000), projection is:
    // 95,000 + 10,000 + 10,000 = 115,000 > 99,000 and compression should run.
    // Set API-observed prompt baseline directly on compression handler via private field.
    (
      chat as unknown as {
        compressionHandler: { lastPromptTokenCount: number };
      }
    ).compressionHandler.lastPromptTokenCount = 95_000;

    let compressionAttempts = 0;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          compressionAttempts++;
          return {
            newHistory: [
              { role: 'user', parts: [{ text: 'hello' }] },
              { role: 'model', parts: [{ text: 'hi' }] },
            ],
            metadata: {
              originalMessageCount: 10,
              compressedMessageCount: 9,
              strategyUsed: 'middle-out' as const,
              llmCallMade: true,
            },
          };
        }),
      }),
    );

    vi.spyOn(chat['historyService'], 'getTotalTokens').mockReturnValue(1_000);

    try {
      await chat['enforceContextWindow'](10_000, 'test-prompt');
    } catch {
      // We only care that hard-limit path did not early-return and attempted compression.
    }

    expect(compressionAttempts).toBeGreaterThan(0);
  });

  /**
   * @requirement REQ-1791.3
   * Error message includes reduction amount, completion budget, and budget warning.
   */
  it('includes diagnostic info in error when budget is large relative to context window', async () => {
    // contextLimit=100000, maxOutputTokens=90000 (90% of window)
    // projected = 80000 + 10000 + 90000 = 180000
    // marginAdjustedLimit = 100000 - 1000 = 99000
    const chat = makeChatForEnforceContextWindow({
      totalTokens: 80_000,
      contextLimit: 100_000,
      maxOutputTokens: 90_000,
    });

    // Make compression return the same history (ineffective)
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      (name) => {
        if (name === 'top-down-truncation') {
          return {
            name: 'top-down-truncation' as const,
            requiresLLM: false,
            trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
            compress: vi.fn().mockResolvedValue({
              newHistory: [
                { role: 'user', parts: [{ text: 'hello' }] },
                { role: 'model', parts: [{ text: 'hi' }] },
              ],
              metadata: {
                originalMessageCount: 10,
                compressedMessageCount: 9,
                strategyUsed: 'top-down-truncation' as const,
                llmCallMade: false,
              },
            }),
          };
        }
        return {
          name: 'middle-out' as const,
          requiresLLM: true,
          trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
          compress: vi.fn().mockResolvedValue({
            newHistory: [
              { role: 'user', parts: [{ text: 'hello' }] },
              { role: 'model', parts: [{ text: 'hi' }] },
            ],
            metadata: {
              originalMessageCount: 10,
              compressedMessageCount: 9,
              strategyUsed: 'middle-out' as const,
              llmCallMade: true,
            },
          }),
        };
      },
    );

    // Keep tokens high so nothing reduces enough
    vi.spyOn(chat['historyService'], 'getTotalTokens').mockReturnValue(80_000);

    let errorMessage = '';
    try {
      await chat['enforceContextWindow'](10_000, 'test-prompt');
    } catch (err) {
      errorMessage = (err as Error).message;
    }

    expect(errorMessage).toContain(
      'Request still exceeds the safety-adjusted context limit (99000 tokens).',
    );
    expect(errorMessage).toContain(
      'density optimization and compression reduced 0 tokens',
    );
    expect(errorMessage).toContain('completionBudget=90000');
    expect(errorMessage).toContain('tokensStillNeeded=81000');
    expect(errorMessage).toContain(
      'consumes more than 80% of the context window (100000)',
    );
    expect(errorMessage).toContain('Consider lowering maxOutputTokens.');
  });

  /**
   * @requirement REQ-1791.4
   * Cooldown is still respected when bypassCooldown is not set (default behavior).
   */
  it('preserves cooldown behavior when not called from enforceContextWindow', async () => {
    const chat = makeChatForEnforceContextWindow({ totalTokens: 100_000 });

    let compressionAttempts = 0;
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      () => ({
        name: 'middle-out' as const,
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(async () => {
          compressionAttempts++;
          throw makeHttpError(500);
        }),
      }),
    );

    // Force cooldown
    await chat.performCompression('test-prompt'); // failure 1
    await chat.performCompression('test-prompt'); // failure 2
    await chat.performCompression('test-prompt'); // failure 3 → cooldown

    const countAtCooldown = compressionAttempts;

    // Should still skip due to cooldown (not bypassed)
    await chat.performCompression('test-prompt');
    expect(compressionAttempts).toBe(countAtCooldown);
  });
});
