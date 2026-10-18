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

import { useEffect, useRef, useState } from 'react';
import { type RecordingIntegration } from '@vybestack/llxprt-code-core';

import type {
  HistoryTokenSubscription,
  RecordingHistorySubscription,
} from './historyTokenSubscriptions.js';
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
  subscribeRecordingHistory: RecordingHistorySubscription;
  readProviderMetrics: GetActiveProviderMetricsOperation;
  readSessionTokenUsage: GetSessionTokenUsageOperation;
  metrics: SessionMetricUpdates;
  updateHistoryTokenCount: (count: number) => void;
  recordingIntegrationRef?: React.MutableRefObject<RecordingIntegration | null>;
  recordingOwner?: 'agent' | 'raw';
}

export interface UseTokenMetricsTrackingResult {
  tokenMetrics: TokenMetrics;
}
function useTokenMetricsPoll(
  readProviderMetrics: UseTokenMetricsTrackingOptions['readProviderMetrics'],
  readSessionTokenUsage: UseTokenMetricsTrackingOptions['readSessionTokenUsage'],
  metricsSource: SessionMetricUpdates,
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

      metricsSource.setTokenTrackingMetrics({
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
  }, [readProviderMetrics, readSessionTokenUsage, metricsSource]);

  return tokenMetrics;
}

export function useTokenMetricsTracking({
  metrics,
  subscribeHistoryTokens,
  subscribeRecordingHistory,
  readProviderMetrics,
  readSessionTokenUsage,
  updateHistoryTokenCount,
  recordingIntegrationRef,
  recordingOwner,
}: UseTokenMetricsTrackingOptions): UseTokenMetricsTrackingResult {
  useEffect(
    () => subscribeHistoryTokens(updateHistoryTokenCount),
    [subscribeHistoryTokens, updateHistoryTokenCount],
  );
  useEffect(() => {
    if (recordingOwner === 'agent' || !recordingIntegrationRef?.current)
      return undefined;
    return subscribeRecordingHistory(recordingIntegrationRef);
  }, [subscribeRecordingHistory, recordingIntegrationRef, recordingOwner]);
  const tokenMetrics = useTokenMetricsPoll(
    readProviderMetrics,
    readSessionTokenUsage,
    metrics,
  );
  return { tokenMetrics };
}
