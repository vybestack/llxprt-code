/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reads cache statistics from the canonical session snapshot
 * (SessionMetricsAggregator via uiTelemetryService.getSessionSnapshot()).
 * This is the single source of truth — not the provider tracker.
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { uiTelemetryService } from '@vybestack/llxprt-code-telemetry';
import { useSessionStats } from '../contexts/SessionContext.js';
import { theme } from '../semantic-colors.js';
import { computeCachedTokenRatio } from '../utils/computeStats.js';

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
      <Text color={theme.text.link}>{isSubtle ? `  ↳ ${title}` : title}</Text>
    </Box>
    <Box width={VALUE_COL_WIDTH} justifyContent="flex-end">
      <Text color={theme.text.primary}>{value}</Text>
    </Box>
  </Box>
);

interface NoStatsBoxProps {
  message: string;
}

const NoStatsBox: React.FC<NoStatsBoxProps> = ({ message }) => (
  <Box
    borderStyle="round"
    borderColor={theme.border.default}
    paddingY={1}
    paddingX={2}
  >
    <Text color={theme.text.primary}>{message}</Text>
  </Box>
);

const CacheStatsHeader: React.FC = () => (
  <>
    <Text bold color={theme.text.accent}>
      Cache Stats
    </Text>
    <Box height={1} />
  </>
);

export const CacheStatsDisplay: React.FC = () => {
  useSessionStats();
  const snap = uiTelemetryService.getSessionSnapshot();
  if (!snap.hasReliableCacheReads && !snap.hasReliableCacheWrites) {
    return (
      <NoStatsBox message="No cache data available. Cache statistics are available for providers that support prompt caching (e.g. Anthropic, OpenAI, Groq, Deepseek, Fireworks, OpenRouter, Qwen)." />
    );
  }

  const cacheReads = snap.totalCacheReads;
  const cacheWrites = snap.totalCacheWrites;
  const requestsWithReads = snap.requestsWithCacheReads;
  const requestsWithWrites = snap.requestsWithCacheWrites;
  const cachedTokenRatio = computeCachedTokenRatio(
    snap.totalCachedTokens,
    snap.totalInputTokens,
  );
  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.default}
      flexDirection="column"
      paddingY={1}
      paddingX={2}
    >
      <CacheStatsHeader />
      {snap.hasReliableCacheReads && (
        <StatRow
          title="Cache Reads (tokens)"
          value={cacheReads.toLocaleString()}
        />
      )}
      {snap.hasReliableCacheWrites && cacheWrites !== null && (
        <StatRow
          title="Cache Writes (tokens)"
          value={cacheWrites.toLocaleString()}
        />
      )}
      {snap.hasReliableCacheReads && (
        <StatRow
          title="Cached Token Ratio"
          value={
            <Text
              color={
                cachedTokenRatio > 0 ? theme.status.success : theme.text.primary
              }
            >
              {cachedTokenRatio.toFixed(1)}%
            </Text>
          }
        />
      )}
      {snap.hasReliableCacheReads && (
        <StatRow
          title="Requests with Cache Reads"
          value={
            <Text color={theme.text.primary}>
              {requestsWithReads.toLocaleString()}
            </Text>
          }
        />
      )}
      {snap.hasReliableCacheWrites && (
        <StatRow
          title="Requests with Cache Writes"
          value={
            <Text color={theme.text.primary}>
              {requestsWithWrites.toLocaleString()}
            </Text>
          }
        />
      )}
    </Box>
  );
};
