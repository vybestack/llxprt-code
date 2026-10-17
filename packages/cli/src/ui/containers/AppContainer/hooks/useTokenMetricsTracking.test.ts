/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, useMemo } from 'react';
import {
  bindHistoryTokenSubscription,
  bindRecordingHistorySubscription,
} from './historyTokenSubscriptions.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { renderHook } from '../../../../__tests__/render.js';
import { useTokenMetricsTracking } from './useTokenMetricsTracking.js';

const realLlxprtCodeTelemetryModule = {
  ...(await import('@vybestack/llxprt-code-telemetry')),
};

const useRuntimeApiMock = vi.fn();
let metricSource = new realLlxprtCodeTelemetryModule.UiTelemetryService();

const selectedRuntimeMock1 = (() =>
  (() => {
    const useSelectedTestRuntime = useRuntimeApiMock;
    return {
      useGetActiveProviderDetails: () =>
        useSelectedTestRuntime().getActiveProviderDetails,
      useGetProviderDumpMetadata: () =>
        useSelectedTestRuntime().getProviderDumpMetadata,
      useGetActiveProviderAliasConfig: () =>
        useSelectedTestRuntime().getActiveProviderAliasConfig,
      useDetectProviderQuota: () =>
        useSelectedTestRuntime().detectProviderQuota,
      useGetLoadBalancerStats: () =>
        useSelectedTestRuntime().getLoadBalancerStats,
      useGetLoadBalancerTokenAccounting: () =>
        useSelectedTestRuntime().getLoadBalancerTokenAccounting,
      useListSavedProfiles: () => useSelectedTestRuntime().listSavedProfiles,
      useGetProfileByName: () => useSelectedTestRuntime().getProfileByName,
      useSaveProfileDefinition: () =>
        useSelectedTestRuntime().saveProfileDefinition,
      useSaveLoadBalancerProfile: () =>
        useSelectedTestRuntime().saveLoadBalancerProfile,
      useListProviders: () => useSelectedTestRuntime().listProviders,
      useGetActiveProviderName: () =>
        useSelectedTestRuntime().getActiveProviderName,
      useListAvailableModels: () =>
        useSelectedTestRuntime().listAvailableModels,
      useGetActiveModelName: () => useSelectedTestRuntime().getActiveModelName,
      useProviderStatus: () => useSelectedTestRuntime().providerStatus,
      useGetUnallowedParametersForActiveModel: () =>
        useSelectedTestRuntime().getUnallowedParametersForActiveModel,
      useGetActiveProviderMetrics: () =>
        useSelectedTestRuntime().getActiveProviderMetrics,
      useGetSessionTokenUsage: () =>
        useSelectedTestRuntime().getSessionTokenUsage,
      useGetEphemeralSettings: () =>
        useSelectedTestRuntime().getEphemeralSettings,
      useSetEphemeralSetting: () =>
        useSelectedTestRuntime().setEphemeralSetting,
      useGetActiveToolFormatState: () =>
        useSelectedTestRuntime().getActiveToolFormatState,
      useSetActiveToolFormatOverride: () =>
        useSelectedTestRuntime().setActiveToolFormatOverride,
      useGetEphemeralSetting: () =>
        useSelectedTestRuntime().getEphemeralSetting,
      useGetSessionSetting: () => useSelectedTestRuntime().getSessionSetting,
      useSetSessionSetting: () => useSelectedTestRuntime().setSessionSetting,
      useClearSessionSetting: () =>
        useSelectedTestRuntime().clearSessionSetting,
      useSetActiveModel: () => useSelectedTestRuntime().setActiveModel,
      useGetActiveModelParams: () =>
        useSelectedTestRuntime().getActiveModelParams,
      useSetActiveModelParam: () =>
        useSelectedTestRuntime().setActiveModelParam,
      useClearActiveModelParam: () =>
        useSelectedTestRuntime().clearActiveModelParam,
      useUpdateActiveProviderApiKey: () =>
        useSelectedTestRuntime().updateActiveProviderApiKey,
      useGetWorkspaceDirectories: () =>
        useSelectedTestRuntime().getWorkspaceDirectories,
      useGetDefaultProfileName: () =>
        useSelectedTestRuntime().getDefaultProfileName,
      useGetOpenAIProviderInfo: () =>
        useSelectedTestRuntime().getOpenAIProviderInfo,
      useGetActiveProfileName: () =>
        useSelectedTestRuntime().getActiveProfileName,
      useSetDefaultProfileName: () =>
        useSelectedTestRuntime().setDefaultProfileName,
      useGetRuntimeDiagnosticsSnapshot: () =>
        useSelectedTestRuntime().getRuntimeDiagnosticsSnapshot,
      useSaveProfileSnapshot: () =>
        useSelectedTestRuntime().saveProfileSnapshot,
      useDeleteProfileByName: () =>
        useSelectedTestRuntime().deleteProfileByName,
      useFetch: () => useSelectedTestRuntime().fetch,
      useSetProvider: () => useSelectedTestRuntime().setProvider,
      useLoadProfileByName: () => useSelectedTestRuntime().loadProfileByName,
      useUpdateActiveProviderBaseUrl: () =>
        useSelectedTestRuntime().updateActiveProviderBaseUrl,
      useRuntimeApi: useSelectedTestRuntime,
    };
  })())();
void vi.mock('../../../contexts/RuntimeContext.js', () => selectedRuntimeMock1);
void vi.mock(
  '../../../../__tests__/runtime-context-fixture.js',
  () => selectedRuntimeMock1,
);

void vi.mock('@vybestack/llxprt-code-telemetry', () => {
  const actual = realLlxprtCodeTelemetryModule;

  class DebugLoggerStub {
    debug(..._args: unknown[]): void {
      // noop in tests
    }
  }

  return {
    ...actual,
    DebugLogger: DebugLoggerStub,
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
  timeToFirstToken?: number | null;
  tokensPerSecond?: number;
};

interface HistoryServiceStub {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  getTotalTokens: ReturnType<typeof vi.fn>;
}

interface AgentClientStub {
  hasChatInitialized: ReturnType<typeof vi.fn>;
  getHistoryService: ReturnType<typeof vi.fn>;
}

interface ConfigStub {
  agentClientSource: {
    getAgentClient: ReturnType<typeof vi.fn>;
  };
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

const makeAgentClient = (
  historyService: HistoryServiceStub,
): AgentClientStub => ({
  hasChatInitialized: vi.fn().mockReturnValue(true),
  getHistoryService: vi.fn().mockReturnValue(historyService),
});

const makeConfig = (agentClient: AgentClientStub): ConfigStub => ({
  agentClientSource: {
    getAgentClient: vi.fn().mockReturnValue(agentClient),
  },
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
    metricSource = new realLlxprtCodeTelemetryModule.UiTelemetryService();
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes initial token metrics and telemetry on mount', () => {
    const historyService = makeHistoryService(13);
    const agentClient = makeAgentClient(historyService);
    const config = makeConfig(agentClient);

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
        metrics: metricSource,
        ...useBindings(config),
        updateHistoryTokenCount,
        recordingIntegrationRef: recordingIntegrationRef as never,
      }),
    );

    expect(result.current.tokenMetrics).toStrictEqual({
      tokensPerMinute: 42,
      throttleWaitTimeMs: 75,
      sessionTokenTotal: 15,
      timeToFirstToken: null,
      tokensPerSecond: 0,
    });

    expect(metricSource.getMetrics().tokenTracking).toStrictEqual({
      tokensPerMinute: 0,
      throttleWaitTimeMs: 75,
      timeToFirstToken: null,
      tokensPerSecond: 0,
      sessionTokenUsage: usage,
    });
  });

  it('subscribes to history service updates and updates history token count', () => {
    const historyService = makeHistoryService(88);
    const agentClient = makeAgentClient(historyService);
    const config = makeConfig(agentClient);

    const runtimeApi = makeRuntimeApi(
      { tokensPerMinute: 10, throttleWaitTimeMs: 20 },
      { input: 1, output: 1, cache: 0, tool: 0, thought: 0, total: 2 },
    );

    useRuntimeApiMock.mockReturnValue(runtimeApi);

    const updateHistoryTokenCount = vi.fn();
    const recordingIntegrationRef = { current: null };

    renderHook(() =>
      useTokenMetricsTracking({
        metrics: metricSource,
        ...useBindings(config),
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
    const agentClient: AgentClientStub = {
      hasChatInitialized: vi.fn().mockReturnValue(true),
      getHistoryService: vi.fn().mockImplementation(() => activeHistoryService),
    };
    const config = makeConfig(agentClient);

    const runtimeApi = makeRuntimeApi(
      { tokensPerMinute: 3, throttleWaitTimeMs: 4 },
      { input: 0, output: 0, cache: 0, tool: 0, thought: 0, total: 0 },
    );

    useRuntimeApiMock.mockReturnValue(runtimeApi);

    const updateHistoryTokenCount = vi.fn();
    const recordingIntegrationRef = { current: null };

    const { unmount } = renderHook(() =>
      useTokenMetricsTracking({
        metrics: metricSource,
        ...useBindings(config),
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
    const agentClient = makeAgentClient(historyService);
    const config = makeConfig(agentClient);

    const runtimeApi = makeRuntimeApi(
      { tokensPerMinute: 12, throttleWaitTimeMs: 34 },
      { input: 2, output: 3, cache: 0, tool: 0, thought: 0, total: 5 },
    );

    useRuntimeApiMock.mockReturnValue(runtimeApi);

    const updateHistoryTokenCount = vi.fn();
    const recordingIntegrationRef = { current: null };

    const updates: number[] = [];
    const unsubscribe = metricSource.subscribe((update) => {
      updates.push(update.metrics.tokenTracking.sessionTokenUsage.total);
    });
    renderHook(() =>
      useTokenMetricsTracking({
        metrics: metricSource,
        ...useBindings(config),
        updateHistoryTokenCount,
        recordingIntegrationRef: recordingIntegrationRef as never,
      }),
    );

    expect(updates).toStrictEqual([5]);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(updates).toStrictEqual([5]);
    unsubscribe();
  });

  it('notifies recording integration when history service appears and changes', () => {
    const historyServiceA = makeHistoryService(10);
    const historyServiceB = makeHistoryService(20);

    let activeHistoryService: HistoryServiceStub = historyServiceA;
    const agentClient: AgentClientStub = {
      hasChatInitialized: vi.fn().mockReturnValue(true),
      getHistoryService: vi.fn().mockImplementation(() => activeHistoryService),
    };
    const config = makeConfig(agentClient);

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
        metrics: metricSource,
        ...useBindings(config),
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
  it('keeps the UI token listener on owner changes without subscribing the raw recorder', () => {
    const first = makeHistoryService(11);
    const second = makeHistoryService(22);
    const firstRuntime = makeConfig(makeAgentClient(first));
    const secondRuntime = makeConfig(makeAgentClient(second));
    useRuntimeApiMock.mockReturnValue(
      makeRuntimeApi(
        { tokensPerMinute: 1, throttleWaitTimeMs: 0 },
        { input: 0, output: 0, cache: 0, tool: 0, thought: 0, total: 0 },
      ),
    );
    const published: number[] = [];
    const rawSubscribe = vi.fn();
    const recordingIntegrationRef = {
      current: { onHistoryServiceReplaced: rawSubscribe },
    };
    const { rerender, unmount } = renderHook(
      ({ uiRuntime }) =>
        useTokenMetricsTracking({
          metrics: metricSource,
          ...useBindings(uiRuntime),
          recordingOwner: 'agent',
          updateHistoryTokenCount: (value) => {
            published.push(value);
          },
          recordingIntegrationRef: recordingIntegrationRef as never,
        }),
      { initialProps: { uiRuntime: firstRuntime } },
    );
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ uiRuntime: secondRuntime });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(published).toStrictEqual([11, 22]);
    expect(first.off).toHaveBeenCalledWith(
      'tokensUpdated',
      expect.any(Function),
    );
    expect(rawSubscribe).not.toHaveBeenCalled();
    unmount();
    expect(second.off).toHaveBeenCalledWith(
      'tokensUpdated',
      expect.any(Function),
    );
  });
});

function useBindings(config: ConfigStub) {
  const runtime: RuntimeApiStub = useRuntimeApiMock();
  const logger = useMemo(() => new DebugLogger('tokens-test'), []);
  const readHistory = useMemo(
    () => () => {
      const client = config.agentClientSource.getAgentClient();
      return client?.hasChatInitialized() === true
        ? (client.getHistoryService() ?? null)
        : null;
    },
    [config],
  );
  return {
    subscribeHistoryTokens: useMemo(
      () => bindHistoryTokenSubscription(readHistory, logger),
      [readHistory, logger],
    ),
    subscribeRecordingHistory: useMemo(
      () => bindRecordingHistorySubscription(readHistory, logger),
      [readHistory, logger],
    ),
    readProviderMetrics: runtime.getActiveProviderMetrics,
    readSessionTokenUsage: runtime.getSessionTokenUsage,
  };
}
