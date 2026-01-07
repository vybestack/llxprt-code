/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Load Balancer Stats Display Component
 * Issue #489 Phase 8
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ExtendedLoadBalancerStats } from '@vybestack/llxprt-code-core';
import { Colors } from '../colors.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';

const METRIC_COL_WIDTH = 35;
const VALUE_COL_WIDTH = 20;

interface StatRowProps {
  title: string;
  value: string | React.ReactElement;
  isSubtle?: boolean;
}

const StatRow: React.FC<StatRowProps> = ({
  title,
  value,
  isSubtle = false,
}) => (
  <Box>
    <Box width={METRIC_COL_WIDTH}>
      <Text color={Colors.Gray}>{isSubtle ? `  ↳ ${title}` : title}</Text>
    </Box>
    <Box width={VALUE_COL_WIDTH} justifyContent="flex-end">
      <Text color={Colors.Foreground}>{value}</Text>
    </Box>
  </Box>
);

export const LBStatsDisplay: React.FC = () => {
  const { getCliProviderManager } = useRuntimeApi();
  const providerManager = getCliProviderManager();

  if (!providerManager) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        paddingY={1}
        paddingX={2}
      >
        <Text color={Colors.Foreground}>Provider manager not available</Text>
      </Box>
    );
  }

  const activeProvider = providerManager.getActiveProvider();

  if (!activeProvider || activeProvider.name !== 'load-balancer') {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        paddingY={1}
        paddingX={2}
      >
        <Text color={Colors.Foreground}>
          No load balancer profile active. Use /profile load to activate a load
          balancer profile.
        </Text>
      </Box>
    );
  }

  // Use getProviderByName to get the actual LoadBalancingProvider instance
  // (wrapped in LoggingProviderWrapper which delegates getStats())
  const lbProvider = providerManager.getProviderByName('load-balancer') as
    | { getStats?: () => ExtendedLoadBalancerStats }
    | undefined;

  // Check if provider exists and has getStats method
  if (
    !lbProvider ||
    !('getStats' in lbProvider) ||
    typeof lbProvider.getStats !== 'function'
  ) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        paddingY={1}
        paddingX={2}
      >
        <Text color={Colors.Foreground}>
          Provider &quot;{activeProvider.name}&quot; does not support load
          balancer statistics.
        </Text>
      </Box>
    );
  }

  // Call getStats() directly on the provider to preserve 'this' binding
  const stats = lbProvider.getStats();
  const backends = Object.keys(stats.backendMetrics);

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      paddingY={1}
      paddingX={2}
    >
      <Text bold color={Colors.Foreground}>
        Load Balancer Statistics
      </Text>
      <Box height={1} />

      <StatRow
        title="Profile Name"
        value={<Text color={Colors.Foreground}>{stats.profileName}</Text>}
      />
      <StatRow
        title="Total Requests"
        value={
          <Text color={Colors.Foreground}>
            {stats.totalRequests.toLocaleString()}
          </Text>
        }
      />
      {stats.lastSelected && (
        <StatRow
          title="Last Selected Backend"
          value={<Text color={Colors.Foreground}>{stats.lastSelected}</Text>}
        />
      )}

      <Box height={1} />
      <Text bold color={Colors.Foreground}>
        Backend Metrics
      </Text>

      {backends.map((backendName) => {
        const metrics = stats.backendMetrics[backendName];
        const cbState = stats.circuitBreakerStates[backendName] ?? {
          state: 'closed' as const,
        };
        const tpm = stats.currentTPM[backendName] || 0;

        return (
          <Box key={backendName} flexDirection="column" marginTop={1}>
            <Text bold color={Colors.Foreground}>
              {backendName}
            </Text>

            <StatRow
              title="Requests"
              value={
                <Text color={Colors.Foreground}>
                  {metrics.requests.toLocaleString()}
                </Text>
              }
              isSubtle
            />
            <StatRow
              title="Successes"
              value={
                <Text color={Colors.Foreground}>
                  {metrics.successes.toLocaleString()}
                </Text>
              }
              isSubtle
            />
            <StatRow
              title="Failures"
              value={
                <Text
                  color={
                    metrics.failures > 0 ? Colors.AccentRed : Colors.Foreground
                  }
                >
                  {metrics.failures.toLocaleString()}
                </Text>
              }
              isSubtle
            />
            <StatRow
              title="Timeouts"
              value={
                <Text
                  color={
                    metrics.timeouts > 0 ? Colors.AccentRed : Colors.Foreground
                  }
                >
                  {metrics.timeouts.toLocaleString()}
                </Text>
              }
              isSubtle
            />
            <StatRow
              title="Tokens"
              value={
                <Text color={Colors.Foreground}>
                  {metrics.tokens.toLocaleString()}
                </Text>
              }
              isSubtle
            />
            <StatRow
              title="Avg Latency (ms)"
              value={
                <Text color={Colors.Foreground}>
                  {metrics.avgLatencyMs.toFixed(2)}
                </Text>
              }
              isSubtle
            />
            <StatRow
              title="Current TPM"
              value={
                <Text color={Colors.Foreground}>
                  {Math.round(tpm).toLocaleString()}
                </Text>
              }
              isSubtle
            />
            <StatRow
              title="Circuit Breaker"
              value={
                <Text
                  color={
                    cbState.state === 'open'
                      ? Colors.AccentRed
                      : cbState.state === 'half-open'
                        ? Colors.AccentYellow
                        : Colors.Foreground
                  }
                >
                  {cbState.state.toUpperCase()}
                </Text>
              }
              isSubtle
            />
          </Box>
        );
      })}
    </Box>
  );
};
