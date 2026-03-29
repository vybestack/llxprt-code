/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '../../../../test-utils/render.js';
import { useTokenMetricsTracking } from './useTokenMetricsTracking.js';

const useRuntimeApiMock = vi.hoisted(() => vi.fn());
const setTokenTrackingMetricsMock = vi.hoisted(() => vi.fn());

vi.mock('../../../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: useRuntimeApiMock,
}));

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-core')
  >('@vybestack/llxprt-code-core');

  class DebugLoggerStub {
    debug(..._args: unknown[]): void {
      // noop in tests
    }
  }

  return {
    ...actual,
    DebugLogger: DebugLoggerStub,
    uiTelemetryService: {
      setTokenTrackingMetrics: setTokenTrackingMetricsMock,
    },
  };
});

type TokenUsage = {
  input: number;
  output: number;
  cache: number;
  tool: number;
  thought: number;
  total: number;
};

type ProviderMetrics = {
  tokensPerMinute: number;
  throttleWaitTimeMs: number;
};

interface HistoryServiceStub {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  getTotalTokens: ReturnType<typeof vi.fn>;
}

interface GeminiClientStub {
  hasChatInitialized: ReturnType<typeof vi.fn>;
  getHistoryService: ReturnType<typeof vi.fn>;
}

interface ConfigStub {
  getGeminiClient: ReturnType<typeof vi.fn>;
}

interface RuntimeApiStub {
  getActiveProviderMetrics: ReturnType<typeof vi.fn>;
  getSessionTokenUsage: ReturnType<typeof vi.fn>;
}

const makeHistoryService = (totalTokens: number): HistoryServiceStub => ({
  on: vi.fn(),
  off: vi.fn(),
  getTotalTokens: vi.fn().mockReturnValue(totalTokens),
});

const makeGeminiClient = (
  historyService: HistoryServiceStub,
): GeminiClientStub => ({
  hasChatInitialized: vi.fn().mockReturnValue(true),
  getHistoryService: vi.fn().mockReturnValue(historyService),
});

const makeConfig = (geminiClient: GeminiClientStub): ConfigStub => ({
  getGeminiClient: vi.fn().mockReturnValue(geminiClient),
});

const makeRuntimeApi = (
  metrics: ProviderMetrics,
  usage: TokenUsage,
): RuntimeApiStub => ({
  getActiveProviderMetrics: vi.fn().mockReturnValue(metrics),
  getSessionTokenUsage: vi.fn().mockReturnValue(usage),
});

describe('useTokenMetricsTracking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes initial token metrics and telemetry on mount', () => {
    const historyService = makeHistoryService(13);
    const geminiClient = makeGeminiClient(historyService);
    const config = makeConfig(geminiClient);

    const usage: TokenUsage = {
      input: 1,
      output: 2,
      cache: 3,
      tool: 4,
      thought: 5,
      total: 15,
    };

    const runtimeApi = makeRuntimeApi(
      { tokensPerMinute: 42, throttleWaitTimeMs: 75 },
      usage,
    );

    useRuntimeApiMock.mockReturnValue(runtimeApi);

    const updateHistoryTokenCount = vi.fn();
    const recordingIntegrationRef = { current: null };

    const { result } = renderHook(() =>
      useTokenMetricsTracking({
        config: config as never,
        updateHistoryTokenCount,
        recordingIntegrationRef: recordingIntegrationRef as never,
      }),
    );

    expect(result.current.tokenMetrics).toStrictEqual({
      tokensPerMinute: 42,
      throttleWaitTimeMs: 75,
      sessionTokenTotal: 15,
    });

    expect(setTokenTrackingMetricsMock).toHaveBeenCalledWith({
      tokensPerMinute: 42,
      throttleWaitTimeMs: 75,
      sessionTokenUsage: usage,
    });
  });

  it('subscribes to history service updates and updates history token count', () => {
    const historyService = makeHistoryService(88);
    const geminiClient = makeGeminiClient(historyService);
    const config = makeConfig(geminiClient);

    const runtimeApi = makeRuntimeApi(
      { tokensPerMinute: 10, throttleWaitTimeMs: 20 },
      { input: 1, output: 1, cache: 0, tool: 0, thought: 0, total: 2 },
    );

    useRuntimeApiMock.mockReturnValue(runtimeApi);

    const updateHistoryTokenCount = vi.fn();
    const recordingIntegrationRef = { current: null };

    renderHook(() =>
      useTokenMetricsTracking({
        config: config as never,
        updateHistoryTokenCount,
        recordingIntegrationRef: recordingIntegrationRef as never,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(historyService.on).toHaveBeenCalledWith(
      'tokensUpdated',
      expect.any(Function),
    );
    expect(updateHistoryTokenCount).toHaveBeenCalledWith(88);

    const handler = historyService.on.mock.calls[0]?.[1] as
      | ((event: { totalTokens: number }) => void)
      | undefined;

    expect(handler).toBeTypeOf('function');

    act(() => {
      handler?.({ totalTokens: 144 });
    });

    expect(updateHistoryTokenCount).toHaveBeenCalledWith(144);
  });

  it('replaces history-service subscription when history service instance changes', () => {
    const historyServiceA = makeHistoryService(5);
    const historyServiceB = makeHistoryService(9);

    let activeHistoryService: HistoryServiceStub = historyServiceA;
    const geminiClient: GeminiClientStub = {
      hasChatInitialized: vi.fn().mockReturnValue(true),
      getHistoryService: vi.fn().mockImplementation(() => activeHistoryService),
    };
    const config = makeConfig(geminiClient);

    const runtimeApi = makeRuntimeApi(
      { tokensPerMinute: 3, throttleWaitTimeMs: 4 },
      { input: 0, output: 0, cache: 0, tool: 0, thought: 0, total: 0 },
    );

    useRuntimeApiMock.mockReturnValue(runtimeApi);

    const updateHistoryTokenCount = vi.fn();
    const recordingIntegrationRef = { current: null };

    const { unmount } = renderHook(() =>
      useTokenMetricsTracking({
        config: config as never,
        updateHistoryTokenCount,
        recordingIntegrationRef: recordingIntegrationRef as never,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const originalHandler = historyServiceA.on.mock.calls[0]?.[1];
    expect(historyServiceA.on).toHaveBeenCalledTimes(1);

    activeHistoryService = historyServiceB;

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(historyServiceA.off).toHaveBeenCalledWith(
      'tokensUpdated',
      originalHandler,
    );
    expect(historyServiceB.on).toHaveBeenCalledWith(
      'tokensUpdated',
      expect.any(Function),
    );

    unmount();

    const latestHandler = historyServiceB.on.mock.calls[0]?.[1];
    expect(historyServiceB.off).toHaveBeenCalledWith(
      'tokensUpdated',
      latestHandler,
    );
  });

  it('does not republish token metrics when snapshot is unchanged across polling', () => {
    const historyService = makeHistoryService(5);
    const geminiClient = makeGeminiClient(historyService);
    const config = makeConfig(geminiClient);

    const runtimeApi = makeRuntimeApi(
      { tokensPerMinute: 12, throttleWaitTimeMs: 34 },
      { input: 2, output: 3, cache: 0, tool: 0, thought: 0, total: 5 },
    );

    useRuntimeApiMock.mockReturnValue(runtimeApi);

    const updateHistoryTokenCount = vi.fn();
    const recordingIntegrationRef = { current: null };

    renderHook(() =>
      useTokenMetricsTracking({
        config: config as never,
        updateHistoryTokenCount,
        recordingIntegrationRef: recordingIntegrationRef as never,
      }),
    );

    expect(setTokenTrackingMetricsMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(setTokenTrackingMetricsMock).toHaveBeenCalledTimes(1);
  });

  it('notifies recording integration when history service appears and changes', () => {
    const historyServiceA = makeHistoryService(10);
    const historyServiceB = makeHistoryService(20);

    let activeHistoryService: HistoryServiceStub = historyServiceA;
    const geminiClient: GeminiClientStub = {
      hasChatInitialized: vi.fn().mockReturnValue(true),
      getHistoryService: vi.fn().mockImplementation(() => activeHistoryService),
    };
    const config = makeConfig(geminiClient);

    const runtimeApi = makeRuntimeApi(
      { tokensPerMinute: 1, throttleWaitTimeMs: 2 },
      { input: 0, output: 0, cache: 0, tool: 0, thought: 0, total: 0 },
    );
    useRuntimeApiMock.mockReturnValue(runtimeApi);

    const updateHistoryTokenCount = vi.fn();
    const onHistoryServiceReplaced = vi.fn();
    const recordingIntegrationRef = {
      current: {
        onHistoryServiceReplaced,
      },
    };

    renderHook(() =>
      useTokenMetricsTracking({
        config: config as never,
        updateHistoryTokenCount,
        recordingIntegrationRef: recordingIntegrationRef as never,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onHistoryServiceReplaced).toHaveBeenCalledWith(historyServiceA);

    activeHistoryService = historyServiceB;

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onHistoryServiceReplaced).toHaveBeenCalledWith(historyServiceB);
  });
});
