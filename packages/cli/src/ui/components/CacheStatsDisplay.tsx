/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { CacheStatistics } from '@vybestack/llxprt-code-core';
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
      <Text color={Colors.Foreground}>{value}</Text>
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
        <Text color={Colors.Foreground}>Provider manager not available</Text>
      </Box>
    );
  }

  // Get cache statistics from ProviderManager
  const cacheStats =
    (
      providerManager as {
        getCacheStatistics?: () => CacheStatistics;
      }
    ).getCacheStatistics?.() ?? null;

  if (!cacheStats) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        paddingY={1}
        paddingX={2}
      >
        <Text color={Colors.Foreground}>
          Cache statistics are not available for the current provider.
        </Text>
      </Box>
    );
  }

  const totalCacheReads = cacheStats.totalCacheReads;
  const totalCacheWrites = cacheStats.totalCacheWrites;
  const requestsWithCacheHits = cacheStats.requestsWithCacheHits;
  const cacheHitRate = cacheStats.hitRate;

  // Check if we have any cache data
  // totalCacheWrites can be null (not reported by provider) vs 0 (explicitly reported as zero)
  const hasCacheData = totalCacheReads > 0 || (totalCacheWrites ?? 0) > 0;

  if (!hasCacheData) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        paddingY={1}
        paddingX={2}
      >
        <Text color={Colors.Foreground}>
          No cache data available. Cache statistics are available for providers
          with prompt caching support (Anthropic, OpenAI, Groq, Deepseek,
          Fireworks, OpenRouter, Qwen).
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
      {/* Only show cache writes if the provider reports them (not null) */}
      {totalCacheWrites !== null && (
        <StatRow
          title="Total Cache Writes (tokens)"
          value={
            <Text color={Colors.Foreground}>
              {totalCacheWrites.toLocaleString()}
            </Text>
          }
        />
      )}
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
