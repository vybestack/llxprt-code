import type { SessionMetricUpdates } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GetActiveProviderMetricsOperation,
  type GetSessionTokenUsageOperation,
} from '../../../contexts/RuntimeContext.js';

/**
 * @hook useTokenMetricsTracking
 * @description Token metrics collection with HistoryService subscription
 * @inputs runtime, uiRuntime, updateHistoryTokenCount, recordingIntegrationRef
 * @outputs tokenMetrics, historyTokenCount
 * @sideEffects Interval (1s), HistoryService subscription
 * @cleanup Clears interval, unsubscribes on unmount/swap
 * @strictMode Safe - subscriptions managed with cleanup
 * @subscriptionStrategy Mixed (Stable subscription + Poll)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryTokenSubscription } from './historyTokenSubscriptions.js';
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
  subscribeHistoryTokens: HistoryTokenSubscription;
  subscribeRecordingHistory: () => () => void;
  readProviderMetrics: GetActiveProviderMetricsOperation;
  readSessionTokenUsage: GetSessionTokenUsageOperation;
  setTokenTrackingMetrics: SessionMetricUpdates['setTokenTrackingMetrics'];
  updateHistoryTokenCount: (count: number) => void;
}

export interface UseTokenMetricsTrackingResult {
  tokenMetrics: TokenMetrics;
  stopTracking: () => void;
}

function registerTrackingCleanup(
  signal: AbortSignal,
  cleanup: () => void,
): () => void {
  let finish: (() => void) | undefined = cleanup;
  const stop = (): void => {
    signal.removeEventListener('abort', stop);
    const current = finish;
    finish = undefined;
    current?.();
  };
  signal.addEventListener('abort', stop, { once: true });
  return stop;
}

function useTokenMetricsPoll(
  readProviderMetrics: UseTokenMetricsTrackingOptions['readProviderMetrics'],
  readSessionTokenUsage: UseTokenMetricsTrackingOptions['readSessionTokenUsage'],
  setTokenTrackingMetrics: SessionMetricUpdates['setTokenTrackingMetrics'],
  signal: AbortSignal,
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
    if (signal.aborted) return undefined;
    const updateTokenMetrics = () => {
      const metrics = readProviderMetrics();
      const usage = readSessionTokenUsage();

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

      setTokenTrackingMetrics({
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

    return registerTrackingCleanup(signal, () => clearInterval(interval));
  }, [
    readProviderMetrics,
    readSessionTokenUsage,
    setTokenTrackingMetrics,
    signal,
  ]);

  return tokenMetrics;
}

export function useTokenMetricsTracking({
  setTokenTrackingMetrics,
  subscribeHistoryTokens,
  subscribeRecordingHistory,
  readProviderMetrics,
  readSessionTokenUsage,
  updateHistoryTokenCount,
}: UseTokenMetricsTrackingOptions): UseTokenMetricsTrackingResult {
  const controller = useMemo(() => new AbortController(), []);
  const stopTracking = useCallback(() => controller.abort(), [controller]);
  useEffect(
    () =>
      controller.signal.aborted
        ? undefined
        : registerTrackingCleanup(
            controller.signal,
            subscribeHistoryTokens(updateHistoryTokenCount),
          ),
    [controller, subscribeHistoryTokens, updateHistoryTokenCount],
  );
  useEffect(
    () =>
      controller.signal.aborted
        ? undefined
        : registerTrackingCleanup(
            controller.signal,
            subscribeRecordingHistory(),
          ),
    [controller, subscribeRecordingHistory],
  );
  const tokenMetrics = useTokenMetricsPoll(
    readProviderMetrics,
    readSessionTokenUsage,
    setTokenTrackingMetrics,
    controller.signal,
  );
  return { tokenMetrics, stopTracking };
}
