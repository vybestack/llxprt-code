/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { type MutableRefObject, act } from 'react';
import { render, renderHook } from '../../test-utils/render.js';
import type { SessionMetrics } from './SessionContext.js';
import { SessionStatsProvider, useSessionStats } from './SessionContext.js';
import { describe, it, expect } from 'vitest';
import { uiTelemetryService } from '@vybestack/llxprt-code-core';

/**
 * A test harness component that uses the hook and exposes the context value
 * via a mutable ref. This allows us to interact with the context's functions
 * and assert against its state directly in our tests.
 */
const TestHarness = ({
  contextRef,
}: {
  contextRef: MutableRefObject<ReturnType<typeof useSessionStats> | undefined>;
}) => {
  contextRef.current = useSessionStats();
  return null;
};

function createRenderCounters() {
  let renderCount = 0;
  const Harness = ({
    contextRef,
  }: {
    contextRef: MutableRefObject<
      ReturnType<typeof useSessionStats> | undefined
    >;
  }) => {
    contextRef.current = useSessionStats();
    renderCount++;
    return null;
  };
  return { Harness, getRenderCount: () => renderCount };
}
describe('SessionStatsContext', () => {
  it('should provide the correct initial state', () => {
    const contextRef: MutableRefObject<
      ReturnType<typeof useSessionStats> | undefined
    > = { current: undefined };

    render(
      <SessionStatsProvider>
        <TestHarness contextRef={contextRef} />
      </SessionStatsProvider>,
    );

    const stats = contextRef.current?.stats;

    expect(stats?.sessionStartTime).toBeInstanceOf(Date);
    expect(stats?.metrics).toBeDefined();
    expect(stats?.metrics.models).toStrictEqual({});
  });

  it('should update metrics when the uiTelemetryService emits an update', () => {
    const contextRef: MutableRefObject<
      ReturnType<typeof useSessionStats> | undefined
    > = { current: undefined };

    render(
      <SessionStatsProvider>
        <TestHarness contextRef={contextRef} />
      </SessionStatsProvider>,
    );

    const newMetrics: SessionMetrics = {
      models: {
        'gemini-pro': {
          api: {
            totalRequests: 1,
            totalErrors: 0,
            totalLatencyMs: 123,
          },
          tokens: {
            input: 50,
            prompt: 100,
            candidates: 200,
            total: 300,
            cached: 50,
            thoughts: 20,
            tool: 10,
          },
        },
      },
      tools: {
        totalCalls: 1,
        totalSuccess: 1,
        totalFail: 0,
        totalCancelled: 0,
        totalDurationMs: 456,
        totalDecisions: {
          accept: 1,
          reject: 0,
          modify: 0,
          auto_accept: 0,
        },
        byName: {
          'test-tool': {
            count: 1,
            success: 1,
            fail: 0,
            cancelled: 0,
            durationMs: 456,
            decisions: {
              accept: 1,
              reject: 0,
              modify: 0,
              auto_accept: 0,
            },
          },
        },
      },
      files: {
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
      },
      tokenTracking: {
        tokensPerMinute: 0,
        throttleWaitTimeMs: 0,
        timeToFirstToken: null,
        tokensPerSecond: 0,
        sessionTokenUsage: {
          input: 0,
          output: 0,
          cache: 0,
          tool: 0,
          thought: 0,
          total: 0,
        },
      },
      timing: {
        completeTokensPerMinute: 0,
        outputGenerationTps: 0,
        effectiveInputTps: 0,
        uncachedInputTps: null,
        lastRequestTpm: 0,
        accumulatedApiTimeMs: 0,
        accumulatedToolTimeMs: 0,
        agentActiveTimeMs: 0,
        accumulatedWorkMs: 0,
        lastTtftMs: null,
        weightedAvgTtftMs: null,
        lastOutputGenerationTps: 0,
        lastEffectiveInputTps: 0,
      },
      cache: {
        hasReliableCacheData: false,
        hasReliableCacheReads: false,
        hasReliableCacheWrites: false,
        requestsWithCacheReads: 0,
        requestsWithCacheWrites: 0,
        totalCacheReads: 0,
        totalCacheWrites: null,
      },
    };

    act(() => {
      uiTelemetryService.emit('update', {
        metrics: newMetrics,
        lastPromptTokenCount: 100,
      });
    });

    const stats = contextRef.current?.stats;
    expect(stats?.metrics).toStrictEqual(newMetrics);
    expect(stats?.lastPromptTokenCount).toBe(100);
  });

  it('should not update metrics if the data is the same', () => {
    const contextRef: MutableRefObject<
      ReturnType<typeof useSessionStats> | undefined
    > = { current: undefined };

    const { Harness: CountingTestHarness, getRenderCount } =
      createRenderCounters();

    render(
      <SessionStatsProvider>
        <CountingTestHarness contextRef={contextRef} />
      </SessionStatsProvider>,
    );

    expect(getRenderCount()).toBe(1);

    const metrics: SessionMetrics = {
      models: {
        'gemini-pro': {
          api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 100 },
          tokens: {
            input: 10,
            prompt: 10,
            candidates: 20,
            total: 30,
            cached: 0,
            thoughts: 0,
            tool: 0,
          },
        },
      },
      tools: {
        totalCalls: 0,
        totalSuccess: 0,
        totalFail: 0,
        totalDurationMs: 0,
        totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
        byName: {},
      },
      files: { totalLinesAdded: 0, totalLinesRemoved: 0 },
      tokenTracking: {
        tokensPerMinute: 0,
        throttleWaitTimeMs: 0,
        timeToFirstToken: null,
        tokensPerSecond: 0,
        sessionTokenUsage: {
          input: 0,
          output: 0,
          cache: 0,
          tool: 0,
          thought: 0,
          total: 0,
        },
      },
      timing: {
        completeTokensPerMinute: 0,
        outputGenerationTps: 0,
        effectiveInputTps: 0,
        uncachedInputTps: null,
        lastRequestTpm: 0,
        accumulatedApiTimeMs: 0,
        accumulatedToolTimeMs: 0,
        agentActiveTimeMs: 0,
        accumulatedWorkMs: 0,
        lastTtftMs: null,
        weightedAvgTtftMs: null,
        lastOutputGenerationTps: 0,
        lastEffectiveInputTps: 0,
      },
      cache: {
        hasReliableCacheData: false,
        hasReliableCacheReads: false,
        hasReliableCacheWrites: false,
        requestsWithCacheReads: 0,
        requestsWithCacheWrites: 0,
        totalCacheReads: 0,
        totalCacheWrites: null,
      },
    };

    act(() => {
      uiTelemetryService.emit('update', { metrics, lastPromptTokenCount: 10 });
    });

    expect(getRenderCount()).toBe(2);

    act(() => {
      uiTelemetryService.emit('update', { metrics, lastPromptTokenCount: 10 });
    });

    expect(getRenderCount()).toBe(2);

    const newMetrics = {
      ...metrics,
      models: {
        'gemini-pro': {
          api: { totalRequests: 2, totalErrors: 0, totalLatencyMs: 200 },
          tokens: {
            input: 20,
            prompt: 20,
            candidates: 40,
            total: 60,
            cached: 0,
            thoughts: 0,
            tool: 0,
          },
        },
      },
    };
    act(() => {
      uiTelemetryService.emit('update', {
        metrics: newMetrics,
        lastPromptTokenCount: 20,
      });
    });

    expect(getRenderCount()).toBe(3);
  });

  it('should throw an error when useSessionStats is used outside of a provider', () => {
    let receivedError: unknown;
    const TestHarness = () => {
      try {
        useSessionStats();
      } catch (error) {
        receivedError = error;
      }
      return null;
    };

    render(<TestHarness />);

    expect(receivedError).toStrictEqual(
      new Error('useSessionStats must be used within a SessionStatsProvider'),
    );
  });

  it('should not trigger re-render when history token count is unchanged', () => {
    const { result } = renderHook(() => useSessionStats(), {
      wrapper: SessionStatsProvider,
    });

    const initialRenderCount = result.all.length;

    act(() => {
      result.current.updateHistoryTokenCount(256);
    });

    expect(result.current.stats.historyTokenCount).toBe(256);
    expect(result.all.length).toBe(initialRenderCount + 1);

    act(() => {
      result.current.updateHistoryTokenCount(256);
    });

    expect(result.all.length).toBe(initialRenderCount + 1);
  });

  it('should trigger re-render when timing fields change', () => {
    const contextRef: MutableRefObject<
      ReturnType<typeof useSessionStats> | undefined
    > = { current: undefined };

    const { Harness: CountingTestHarness, getRenderCount } =
      createRenderCounters();

    render(
      <SessionStatsProvider>
        <CountingTestHarness contextRef={contextRef} />
      </SessionStatsProvider>,
    );

    const baseRenderCount = getRenderCount();

    const metricsWithTiming: SessionMetrics = {
      models: {},
      tools: {
        totalCalls: 0,
        totalSuccess: 0,
        totalFail: 0,
        totalCancelled: 0,
        totalDurationMs: 0,
        totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
        byName: {},
      },
      files: { totalLinesAdded: 0, totalLinesRemoved: 0 },
      tokenTracking: {
        tokensPerMinute: 0,
        throttleWaitTimeMs: 0,
        timeToFirstToken: null,
        tokensPerSecond: 0,
        sessionTokenUsage: {
          input: 0,
          output: 0,
          cache: 0,
          tool: 0,
          thought: 0,
          total: 0,
        },
      },
      timing: {
        completeTokensPerMinute: 1000,
        outputGenerationTps: 10,
        effectiveInputTps: 500,
        uncachedInputTps: null,
        lastRequestTpm: 2000,
        accumulatedApiTimeMs: 5000,
        accumulatedToolTimeMs: 3000,
        agentActiveTimeMs: 7000,
        accumulatedWorkMs: 8000,
        lastTtftMs: null,
        weightedAvgTtftMs: null,
        lastOutputGenerationTps: 0,
        lastEffectiveInputTps: 0,
      },
      cache: {
        hasReliableCacheData: false,
        hasReliableCacheReads: false,
        hasReliableCacheWrites: false,
        requestsWithCacheReads: 0,
        requestsWithCacheWrites: 0,
        totalCacheReads: 0,
        totalCacheWrites: null,
      },
    };

    act(() => {
      uiTelemetryService.emit('update', {
        metrics: metricsWithTiming,
        lastPromptTokenCount: 0,
      });
    });

    // Should re-render because timing fields changed
    expect(getRenderCount()).toBeGreaterThan(baseRenderCount);
    const updatedRenderCount = getRenderCount();

    // Emit identical metrics — should NOT re-render
    act(() => {
      uiTelemetryService.emit('update', {
        metrics: metricsWithTiming,
        lastPromptTokenCount: 0,
      });
    });

    expect(getRenderCount()).toBe(updatedRenderCount);
  });

  it('should trigger re-render when cache fields change', () => {
    const contextRef: MutableRefObject<
      ReturnType<typeof useSessionStats> | undefined
    > = { current: undefined };

    const { Harness: CountingTestHarness, getRenderCount } =
      createRenderCounters();

    render(
      <SessionStatsProvider>
        <CountingTestHarness contextRef={contextRef} />
      </SessionStatsProvider>,
    );

    const baseRenderCount = getRenderCount();

    const metricsWithCache: SessionMetrics = {
      models: {},
      tools: {
        totalCalls: 0,
        totalSuccess: 0,
        totalFail: 0,
        totalCancelled: 0,
        totalDurationMs: 0,
        totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
        byName: {},
      },
      files: { totalLinesAdded: 0, totalLinesRemoved: 0 },
      tokenTracking: {
        tokensPerMinute: 0,
        throttleWaitTimeMs: 0,
        timeToFirstToken: null,
        tokensPerSecond: 0,
        sessionTokenUsage: {
          input: 0,
          output: 0,
          cache: 0,
          tool: 0,
          thought: 0,
          total: 0,
        },
      },
      timing: {
        completeTokensPerMinute: 0,
        outputGenerationTps: 0,
        effectiveInputTps: 0,
        uncachedInputTps: null,
        lastRequestTpm: 0,
        accumulatedApiTimeMs: 0,
        accumulatedToolTimeMs: 0,
        agentActiveTimeMs: 0,
        accumulatedWorkMs: 0,
        lastTtftMs: null,
        weightedAvgTtftMs: null,
        lastOutputGenerationTps: 0,
        lastEffectiveInputTps: 0,
      },
      cache: {
        hasReliableCacheData: true,
        hasReliableCacheReads: true,
        hasReliableCacheWrites: true,
        totalCacheReads: 500,
        totalCacheWrites: 200,
        requestsWithCacheReads: 3,
        requestsWithCacheWrites: 2,
      },
    };

    act(() => {
      uiTelemetryService.emit('update', {
        metrics: metricsWithCache,
        lastPromptTokenCount: 0,
      });
    });

    expect(getRenderCount()).toBeGreaterThan(baseRenderCount);
  });
});
