/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
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

export const CacheStatsDisplay: React.FC = () => {
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

  // Get cache statistics from ProviderManager
  const cacheStats = providerManager.getCacheStatistics();

  const totalCacheReads = cacheStats.totalCacheReads;
  const totalCacheWrites = cacheStats.totalCacheWrites;
  const requestsWithCacheHits = cacheStats.requestsWithCacheHits;
  const cacheHitRate = cacheStats.hitRate;

  // Calculate token savings (cache reads cost 10% of regular tokens, so 90% savings)
  const tokenSavings = Math.floor(totalCacheReads * 0.9);

  // Estimate cost savings (using rough Anthropic pricing: $0.003 per 1K input tokens for Claude 3.5 Sonnet)
  const costSavingsPerThousandTokens = 0.003 * 0.9; // 90% savings on cache hits
  const estimatedCostSavings =
    (tokenSavings / 1000) * costSavingsPerThousandTokens;

  // Check if we have any cache data
  const hasCacheData = totalCacheReads > 0 || totalCacheWrites > 0;

  if (!hasCacheData) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        paddingY={1}
        paddingX={2}
      >
        <Text color={Colors.Foreground}>
          No cache data available. Cache statistics are only available for
          Anthropic requests with prompt caching enabled.
        </Text>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      paddingY={1}
      paddingX={2}
    >
      <Text bold color={Colors.AccentPurple}>
        Cache Stats
      </Text>
      <Box height={1} />

      {/* Cache Usage */}
      <StatRow
        title="Total Cache Reads (tokens)"
        value={
          <Text color={Colors.AccentGreen}>
            {totalCacheReads.toLocaleString()}
          </Text>
        }
      />
      <StatRow
        title="Total Cache Writes (tokens)"
        value={
          <Text color={Colors.Foreground}>
            {totalCacheWrites.toLocaleString()}
          </Text>
        }
      />
      <StatRow
        title="Cache Hit Rate"
        value={
          <Text
            color={cacheHitRate > 0 ? Colors.AccentGreen : Colors.Foreground}
          >
            {cacheHitRate.toFixed(1)}%
          </Text>
        }
      />

      <Box height={1} />

      {/* Savings */}
      <StatRow
        title="Token Savings"
        value={
          <Text color={Colors.AccentYellow}>
            {tokenSavings.toLocaleString()}
          </Text>
        }
      />
      <StatRow
        title="Estimated Cost Savings"
        value={
          <Text color={Colors.AccentYellow}>
            ${estimatedCostSavings.toFixed(4)}
          </Text>
        }
      />

      <Box height={1} />

      {/* Request Stats */}
      <StatRow
        title="Requests with Cache Hits"
        value={
          <Text color={Colors.Foreground}>
            {requestsWithCacheHits.toLocaleString()}
          </Text>
        }
      />
    </Box>
  );
};
