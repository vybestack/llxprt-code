/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @hook useTokenMetricsTracking
 * @description Token metrics collection with HistoryService subscription
 * @inputs runtime, config, updateHistoryTokenCount, recordingIntegrationRef
 * @outputs tokenMetrics, historyTokenCount
 * @sideEffects Interval (1s), HistoryService subscription
 * @cleanup Clears interval, unsubscribes on unmount/swap
 * @strictMode Safe - subscriptions managed with cleanup
 * @subscriptionStrategy Mixed (Stable subscription + Poll)
 */

import { useEffect, useRef, useMemo, useState } from 'react';
import {
  DebugLogger,
  uiTelemetryService,
  type RecordingIntegration,
  type Config,
} from '@vybestack/llxprt-code-core';
import { useRuntimeApi } from '../../../contexts/RuntimeContext.js';
import {
  shouldUpdateTokenMetrics,
  toTokenMetricsSnapshot,
  type TokenMetricsSnapshot,
} from '../../../utils/tokenMetricsTracker.js';

export interface TokenMetrics {
  tokensPerMinute: number;
  throttleWaitTimeMs: number;
  sessionTokenTotal: number;
  timeToFirstToken: number | null;
  tokensPerSecond: number;
}

interface UseTokenMetricsTrackingOptions {
  config: Config;
  updateHistoryTokenCount: (count: number) => void;
  recordingIntegrationRef: React.MutableRefObject<RecordingIntegration | null>;
}

export interface UseTokenMetricsTrackingResult {
  tokenMetrics: TokenMetrics;
}

function useHistoryTokenListener(
  config: Config,
  updateHistoryTokenCount: (count: number) => void,
  tokenLogger: DebugLogger,
): void {
  const historyTokenCleanupRef = useRef<(() => void) | null>(null);
  const lastHistoryServiceRef = useRef<unknown>(null);
  const lastPublishedHistoryTokensRef = useRef<number | null>(null);

  useEffect(() => {
    let intervalCleared = false;

    const checkInterval = setInterval(() => {
      if (intervalCleared) return;

      const geminiClient = config.getGeminiClient();

      if (geminiClient?.hasChatInitialized?.()) {
        const historyService = geminiClient.getHistoryService?.() ?? null;

        // Handle service identity change (including transition to null).
        if (historyService !== lastHistoryServiceRef.current) {
          // Clean up listener from the old service regardless of whether the
          // new service is truthy — a reset may have cleared the service.
          if (historyTokenCleanupRef.current) {
            historyTokenCleanupRef.current();
            historyTokenCleanupRef.current = null;
          }
          lastHistoryServiceRef.current = historyService ?? null;

          if (historyService) {
            tokenLogger.debug(
              () => 'Found new history service, setting up listener',
            );

            const handleTokensUpdated = (event: { totalTokens: number }) => {
              tokenLogger.debug(
                () =>
                  `Received tokensUpdated event: totalTokens=${event.totalTokens}`,
              );
              if (event.totalTokens !== lastPublishedHistoryTokensRef.current) {
                lastPublishedHistoryTokensRef.current = event.totalTokens;
                updateHistoryTokenCount(event.totalTokens);
              }
            };

            historyService.on('tokensUpdated', handleTokensUpdated);

            const currentTokens = historyService.getTotalTokens();
            tokenLogger.debug(() => `Initial token count: ${currentTokens}`);
            lastPublishedHistoryTokensRef.current = currentTokens;
            updateHistoryTokenCount(currentTokens);

            historyTokenCleanupRef.current = () => {
              historyService.off('tokensUpdated', handleTokensUpdated);
            };
          } else {
            tokenLogger.debug(() => 'History service reset to undefined');
          }
        }
      }
    }, 100); // Check every 100ms

    return () => {
      clearInterval(checkInterval);
      intervalCleared = true;
      if (historyTokenCleanupRef.current) {
        historyTokenCleanupRef.current();
        historyTokenCleanupRef.current = null;
      }
      lastHistoryServiceRef.current = null;
      lastPublishedHistoryTokensRef.current = null;
    };
  }, [config, updateHistoryTokenCount, tokenLogger]);
}

/**
 * @plan:PLAN-20260211-SESSIONRECORDING.P26
 * @pseudocode recording-integration.md lines 38-59
 *
 * Subscribe RecordingIntegration to HistoryService events when the
 * HistoryService becomes available. Re-subscribes when the HistoryService
 * instance changes (e.g. after compression creates a new instance, or
 * after provider switch triggers GeminiClient.startChat()).
 */
function useRecordingSubscription(
  config: Config,
  recordingIntegrationRef: React.MutableRefObject<RecordingIntegration | null>,
  tokenLogger: DebugLogger,
): void {
  const recordingSubscribedServiceRef = useRef<unknown>(null);

  useEffect(() => {
    // The effect bails early when recordingIntegrationRef.current is null at mount
    // time, but ref identity is stable so the effect never re-runs for late-arriving
    // recording integrations. The polling interval below handles this: each tick checks
    // recordingIntegrationRef.current?.onHistoryServiceReplaced, so a recording
    // integration that arrives after mount is automatically picked up on the next tick.
    if (!recordingIntegrationRef.current) return;

    let intervalCleared = false;
    const checkInterval = setInterval(() => {
      if (intervalCleared) return;

      const geminiClient = config.getGeminiClient();
      if (geminiClient?.hasChatInitialized?.()) {
        const historyService = geminiClient.getHistoryService?.();
        if (
          historyService &&
          historyService !== recordingSubscribedServiceRef.current
        ) {
          recordingSubscribedServiceRef.current = historyService;
          recordingIntegrationRef.current?.onHistoryServiceReplaced(
            historyService,
          );
          tokenLogger.debug(
            'RecordingIntegration subscribed to HistoryService',
          );
        }
      }
    }, 100);

    return () => {
      clearInterval(checkInterval);
      intervalCleared = true;
      recordingSubscribedServiceRef.current = null;
    };
  }, [config, recordingIntegrationRef, tokenLogger]);
}

function useTokenMetricsPoll(
  runtime: ReturnType<typeof useRuntimeApi>,
): TokenMetrics {
  const [tokenMetrics, setTokenMetrics] = useState<TokenMetrics>({
    tokensPerMinute: 0,
    throttleWaitTimeMs: 0,
    sessionTokenTotal: 0,
    timeToFirstToken: null,
    tokensPerSecond: 0,
  });
  const tokenMetricsSnapshotRef = useRef<TokenMetricsSnapshot | null>(null);

  useEffect(() => {
    const updateTokenMetrics = () => {
      const metrics = runtime.getActiveProviderMetrics();
      const usage = runtime.getSessionTokenUsage();

      if (
        !shouldUpdateTokenMetrics(
          tokenMetricsSnapshotRef.current,
          metrics,
          usage,
        )
      ) {
        return;
      }

      const snapshot = toTokenMetricsSnapshot(metrics, usage);
      tokenMetricsSnapshotRef.current = snapshot;

      setTokenMetrics({
        tokensPerMinute: snapshot.tokensPerMinute,
        throttleWaitTimeMs: snapshot.throttleWaitTimeMs,
        sessionTokenTotal: snapshot.sessionTokenTotal,
        timeToFirstToken: snapshot.timeToFirstToken,
        tokensPerSecond: snapshot.tokensPerSecond,
      });

      uiTelemetryService.setTokenTrackingMetrics({
        tokensPerMinute: snapshot.tokensPerMinute,
        throttleWaitTimeMs: snapshot.throttleWaitTimeMs,
        timeToFirstToken: snapshot.timeToFirstToken,
        tokensPerSecond: snapshot.tokensPerSecond,
        sessionTokenUsage: usage,
      });
    };

    updateTokenMetrics();

    // Poll every second to show live updates
    const interval = setInterval(updateTokenMetrics, 1000);

    return () => clearInterval(interval);
  }, [runtime]);

  return tokenMetrics;
}

export function useTokenMetricsTracking({
  config,
  updateHistoryTokenCount,
  recordingIntegrationRef,
}: UseTokenMetricsTrackingOptions): UseTokenMetricsTrackingResult {
  const runtime = useRuntimeApi();
  const tokenLogger = useMemo(
    () => new DebugLogger('llxprt:ui:tokentracking'),
    [],
  );

  useHistoryTokenListener(config, updateHistoryTokenCount, tokenLogger);
  useRecordingSubscription(config, recordingIntegrationRef, tokenLogger);
  const tokenMetrics = useTokenMetricsPoll(runtime);

  return { tokenMetrics };
}
