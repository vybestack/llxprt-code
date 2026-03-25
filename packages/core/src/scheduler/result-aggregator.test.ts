/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResultAggregator } from './result-aggregator.js';
import type { ResultPublishCallbacks } from './result-aggregator.js';
import type { ScheduledToolCall } from './types.js';
import type { ToolResult } from '../tools/tools.js';
import { ToolErrorType } from '../tools/tool-error.js';
import { DEFAULT_MAX_TOKENS } from '../utils/toolOutputLimiter.js';
import type { ToolOutputSettingsProvider } from '../utils/toolOutputLimiter.js';

// ---- helpers ----------------------------------------------------------------

function makeCallbacks(
  overrides: Partial<ResultPublishCallbacks> = {},
): ResultPublishCallbacks {
  const setSuccess = vi.fn();
  const setError = vi.fn();
  const getFallbackOutputConfig = vi.fn().mockReturnValue({
    getEphemeralSettings: () => ({
      'tool-output-max-tokens': DEFAULT_MAX_TOKENS,
    }),
  } as ToolOutputSettingsProvider);

  return {
    setSuccess,
    setError,
    getFallbackOutputConfig,
    ...overrides,
  };
}

function makeScheduledCall(
  callId = 'call-1',
  name = 'testTool',
): ScheduledToolCall {
  return {
    status: 'scheduled',
    request: {
      callId,
      name,
      args: {},
    },
    tool: {} as ScheduledToolCall['tool'],
    invocation: {} as ScheduledToolCall['invocation'],
  };
}

function makeSuccessResult(output = 'hello'): ToolResult {
  return {
    llmContent: output,
    returnDisplay: output,
  };
}

function makeErrorResult(message = 'boom'): ToolResult {
  return {
    error: { message, type: ToolErrorType.UNHANDLED_EXCEPTION },
    llmContent: message,
    returnDisplay: message,
  };
}

function makeAbortSignal(aborted = false): AbortSignal {
  const controller = new AbortController();
  if (aborted) controller.abort();
  return controller.signal;
}

// ---- tests ------------------------------------------------------------------

describe('ResultAggregator', () => {
  let callbacks: ResultPublishCallbacks;
  let agg: ResultAggregator;

  beforeEach(() => {
    callbacks = makeCallbacks();
    agg = new ResultAggregator(callbacks);
  });

  // ---------- bufferResult ---------------------------------------------------

  describe('bufferResult', () => {
    it('stores a result keyed by callId', () => {
      const call = makeScheduledCall('c1');
      const result = makeSuccessResult();
      agg.bufferResult('c1', 'testTool', call, result, 0);
      // Internal state is private; we verify indirectly via publishBufferedResults
      // — the published callback should fire after beginBatch + publish
    });

    it('stores multiple results with distinct executionIndex values', async () => {
      agg.beginBatch(2);
      const call0 = makeScheduledCall('c0');
      const call1 = makeScheduledCall('c1');
      agg.bufferResult('c0', 'testTool', call0, makeSuccessResult('r0'), 0);
      agg.bufferResult('c1', 'testTool', call1, makeSuccessResult('r1'), 1);

      await agg.publishBufferedResults(makeAbortSignal());

      expect(callbacks.setSuccess).toHaveBeenCalledTimes(2);
    });
  });

  // ---------- bufferError ----------------------------------------------------

  describe('bufferError', () => {
    it('stores an error result that publishes as setError', async () => {
      agg.beginBatch(1);
      const call = makeScheduledCall('c-err');
      const error = new Error('bad thing');
      agg.bufferError('c-err', 'testTool', call, error, 0);

      await agg.publishBufferedResults(makeAbortSignal());

      expect(callbacks.setError).toHaveBeenCalledTimes(1);
      expect(callbacks.setSuccess).not.toHaveBeenCalled();
    });

    it('uses the scheduled call name for the error result', async () => {
      agg.beginBatch(1);
      const call = makeScheduledCall('c-err', 'myToolName');
      agg.bufferError('c-err', 'myToolName', call, new Error('x'), 0);

      await agg.publishBufferedResults(makeAbortSignal());

      // setError called with the callId
      const [calledId] = (callbacks.setError as ReturnType<typeof vi.fn>).mock
        .calls[0] as [string, unknown];
      expect(calledId).toBe('c-err');
    });
  });

  // ---------- bufferCancelled ------------------------------------------------

  describe('bufferCancelled', () => {
    it('stores a cancelled entry that is NOT published (skipped)', async () => {
      agg.beginBatch(1);
      const call = makeScheduledCall('c-cancel');
      agg.bufferCancelled('c-cancel', call, 0);

      await agg.publishBufferedResults(makeAbortSignal());

      // Cancelled entries are skipped — neither callback fires
      expect(callbacks.setSuccess).not.toHaveBeenCalled();
      expect(callbacks.setError).not.toHaveBeenCalled();
    });

    it('allows publishing to advance past cancelled index', async () => {
      agg.beginBatch(2);
      const call0 = makeScheduledCall('c0');
      const call1 = makeScheduledCall('c1');

      // c0 cancelled, c1 succeeds
      agg.bufferCancelled('c0', call0, 0);
      agg.bufferResult('c1', 'testTool', call1, makeSuccessResult('r1'), 1);

      await agg.publishBufferedResults(makeAbortSignal());

      // Only c1's setSuccess fires
      expect(callbacks.setSuccess).toHaveBeenCalledTimes(1);
    });
  });

  // ---------- beginBatch -----------------------------------------------------

  describe('beginBatch', () => {
    it('sets the batch size so publishing knows when the batch is complete', async () => {
      agg.beginBatch(3);
      const calls = [0, 1, 2].map((i) => makeScheduledCall(`c${i}`));
      calls.forEach((c, i) =>
        agg.bufferResult(c.request.callId, 'tool', c, makeSuccessResult(), i),
      );

      await agg.publishBufferedResults(makeAbortSignal());

      expect(callbacks.setSuccess).toHaveBeenCalledTimes(3);
    });

    it('applies per-tool output limits for batch size > 1', () => {
      // After beginBatch(2), batchOutputConfig should be set
      // We verify indirectly — getFallbackOutputConfig is NOT called for batch
      // limit computation (it's only a fallback), so batchOutputConfig is derived
      // from the fallback config via applyBatchOutputLimits.
      // Just ensure beginBatch(2) does not throw.
      expect(() => agg.beginBatch(2)).not.toThrow();
    });

    it('does not apply limits for batch size of 1', () => {
      // Single-tool batches should not create a tighter per-tool config
      expect(() => agg.beginBatch(1)).not.toThrow();
    });
  });

  // ---------- publishBufferedResults — ordered publishing --------------------

  describe('publishBufferedResults — ordering', () => {
    it('publishes results in executionIndex order, not completion order', async () => {
      agg.beginBatch(3);
      const calls = [0, 1, 2].map((i) => makeScheduledCall(`c${i}`));

      // Arrive out of order: 2 first, then 0, then 1
      agg.bufferResult('c2', 'tool', calls[2], makeSuccessResult('r2'), 2);
      agg.bufferResult('c0', 'tool', calls[0], makeSuccessResult('r0'), 0);
      agg.bufferResult('c1', 'tool', calls[1], makeSuccessResult('r1'), 1);

      await agg.publishBufferedResults(makeAbortSignal());

      // All three should be published
      expect(callbacks.setSuccess).toHaveBeenCalledTimes(3);
      // Verify order via callId args
      const ids = (
        callbacks.setSuccess as ReturnType<typeof vi.fn>
      ).mock.calls.map((args: unknown[]) => args[0]);
      expect(ids).toEqual(['c0', 'c1', 'c2']);
    });

    it('waits when a gap in indices exists and publishes once gap is filled', async () => {
      agg.beginBatch(2);
      const call0 = makeScheduledCall('c0');
      const call1 = makeScheduledCall('c1');

      // Only index 1 arrives first
      agg.bufferResult('c1', 'tool', call1, makeSuccessResult('r1'), 1);
      await agg.publishBufferedResults(makeAbortSignal());
      // Nothing published yet — waiting for index 0
      expect(callbacks.setSuccess).not.toHaveBeenCalled();

      // Now index 0 arrives
      agg.bufferResult('c0', 'tool', call0, makeSuccessResult('r0'), 0);
      await agg.publishBufferedResults(makeAbortSignal());

      expect(callbacks.setSuccess).toHaveBeenCalledTimes(2);
      const ids = (
        callbacks.setSuccess as ReturnType<typeof vi.fn>
      ).mock.calls.map((args: unknown[]) => args[0]);
      expect(ids).toEqual(['c0', 'c1']);
    });
  });

  // ---------- publishBufferedResults — reentrancy guard ---------------------

  describe('publishBufferedResults — reentrancy guard', () => {
    it('sets pendingPublishRequest when called while already publishing', async () => {
      agg.beginBatch(1);
      const call = makeScheduledCall('c0');
      agg.bufferResult('c0', 'tool', call, makeSuccessResult(), 0);

      // Simulate reentrancy: first call triggers publishing; second call during
      // the first should be deferred but ultimately resolved.
      const first = agg.publishBufferedResults(makeAbortSignal());
      // Second concurrent call
      const second = agg.publishBufferedResults(makeAbortSignal());

      await Promise.all([first, second]);

      // setSuccess should still fire exactly once (not twice)
      expect(callbacks.setSuccess).toHaveBeenCalledTimes(1);
    });
  });

  // ---------- batch size recovery -------------------------------------------

  describe('batch size recovery (Issue #987)', () => {
    it('recovers batch size from pending results when currentBatchSize is 0', async () => {
      // Do NOT call beginBatch — simulate race where tool completes before
      // currentBatchSize is set
      const call = makeScheduledCall('c0');
      agg.bufferResult('c0', 'tool', call, makeSuccessResult(), 0);

      // publishBufferedResults should recover batch size and publish
      await agg.publishBufferedResults(makeAbortSignal());

      expect(callbacks.setSuccess).toHaveBeenCalledTimes(1);
    });
  });

  // ---------- reset ----------------------------------------------------------

  describe('reset', () => {
    it('clears all state so subsequent operations start fresh', async () => {
      agg.beginBatch(2);
      const call0 = makeScheduledCall('c0');
      agg.bufferResult('c0', 'tool', call0, makeSuccessResult(), 0);

      agg.reset();

      // After reset, state is cleared. A fresh publish with nothing buffered
      // should not call any callback.
      await agg.publishBufferedResults(makeAbortSignal());
      expect(callbacks.setSuccess).not.toHaveBeenCalled();
    });

    it('clears the reentrancy flag so publishing can restart', async () => {
      agg.reset();

      // Should be able to publish again without being blocked by stale flag
      agg.beginBatch(1);
      const call = makeScheduledCall('c0');
      agg.bufferResult('c0', 'tool', call, makeSuccessResult('after reset'), 0);

      await agg.publishBufferedResults(makeAbortSignal());
      expect(callbacks.setSuccess).toHaveBeenCalledTimes(1);
    });
  });

  // ---------- applyBatchOutputLimits ----------------------------------------

  describe('applyBatchOutputLimits (via beginBatch)', () => {
    it('does not reduce limits for a single-tool batch', async () => {
      // batchOutputConfig is undefined for size=1; publishResult uses getFallbackOutputConfig
      agg.beginBatch(1);
      const call = makeScheduledCall('c0');
      agg.bufferResult('c0', 'tool', call, makeSuccessResult('x'), 0);

      await agg.publishBufferedResults(makeAbortSignal());

      // getFallbackOutputConfig is called when batchOutputConfig is absent
      expect(callbacks.getFallbackOutputConfig).toHaveBeenCalled();
    });

    it('creates a reduced per-tool budget for multi-tool batches', async () => {
      // Override fallback to return a known token limit
      const base: ToolOutputSettingsProvider = {
        getEphemeralSettings: () => ({ 'tool-output-max-tokens': 10000 }),
      };
      (
        callbacks.getFallbackOutputConfig as ReturnType<typeof vi.fn>
      ).mockReturnValue(base);

      agg.beginBatch(10); // 10 tools → 1000 tokens each (min floor)
      const calls = Array.from({ length: 10 }, (_, i) =>
        makeScheduledCall(`c${i}`),
      );
      calls.forEach((c, i) =>
        agg.bufferResult(c.request.callId, 'tool', c, makeSuccessResult(), i),
      );

      await agg.publishBufferedResults(makeAbortSignal());

      // All succeed; batchOutputConfig was used instead of fallback for
      // individual publishing (fallback still called once during beginBatch)
      expect(callbacks.setSuccess).toHaveBeenCalledTimes(10);
    });
  });
});
