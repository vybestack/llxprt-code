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
      <Text color={Colors.LightBlue}>{isSubtle ? `  ↳ ${title}` : title}</Text>
    </Box>
    <Box width={VALUE_COL_WIDTH} justifyContent="flex-end">
      <Text>{value}</Text>
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
        <Text>Provider manager not available</Text>
      </Box>
    );
  }

  const currentProvider = providerManager.getActiveProvider();

  if (!currentProvider || currentProvider.name !== 'load-balancer') {
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

  const getStats = (
    currentProvider as { getStats?: () => ExtendedLoadBalancerStats }
  ).getStats;

  if (!getStats) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        paddingY={1}
        paddingX={2}
      >
        <Text color={Colors.Foreground}>
          Load balancer statistics not yet implemented.
        </Text>
      </Box>
    );
  }

  const stats = getStats();
  const backends = Object.keys(stats.backendMetrics);

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      paddingY={1}
      paddingX={2}
    >
      <Text bold color={Colors.AccentPurple}>
        Load Balancer Statistics
      </Text>
      <Box height={1} />

      <StatRow
        title="Profile Name"
        value={<Text color={Colors.AccentGreen}>{stats.profileName}</Text>}
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
      <Text bold color={Colors.LightBlue}>
        Backend Metrics
      </Text>

      {backends.map((backendName) => {
        const metrics = stats.backendMetrics[backendName];
        const cbState = stats.circuitBreakerStates[backendName];
        const tpm = stats.currentTPM[backendName] || 0;

        return (
          <Box key={backendName} flexDirection="column" marginTop={1}>
            <Text bold color={Colors.AccentPurple}>
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
                <Text color={Colors.AccentGreen}>
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
                <Text color={Colors.AccentGreen}>
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
                        : Colors.AccentGreen
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
