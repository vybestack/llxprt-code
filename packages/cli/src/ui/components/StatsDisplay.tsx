/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { themeManager } from '../themes/theme-manager.js';
import { formatDuration } from '../utils/formatters.js';
import { CumulativeStats } from '../contexts/SessionContext.js';
import { FormattedStats, StatRow, StatsColumn } from './Stats.js';

// --- Constants ---

const COLUMN_WIDTH = '48%';

// --- Prop and Data Structures ---

interface StatsDisplayProps {
  stats: CumulativeStats;
  lastTurnStats: CumulativeStats;
  duration: string;
}

// --- Main Component ---

export const StatsDisplay: React.FC<StatsDisplayProps> = ({
  stats,
  lastTurnStats,
  duration,
}) => {
  const theme = themeManager.getActiveTheme();
  const lastTurnFormatted: FormattedStats = {
    inputTokens: lastTurnStats.promptTokenCount,
    outputTokens: lastTurnStats.candidatesTokenCount,
    toolUseTokens: lastTurnStats.toolUsePromptTokenCount,
    thoughtsTokens: lastTurnStats.thoughtsTokenCount,
    cachedTokens: lastTurnStats.cachedContentTokenCount,
    totalTokens: lastTurnStats.totalTokenCount,
  };

  const cumulativeFormatted: FormattedStats = {
    inputTokens: stats.promptTokenCount,
    outputTokens: stats.candidatesTokenCount,
    toolUseTokens: stats.toolUsePromptTokenCount,
    thoughtsTokens: stats.thoughtsTokenCount,
    cachedTokens: stats.cachedContentTokenCount,
    totalTokens: stats.totalTokenCount,
  };

  return (
    <Box
      borderStyle="round"
      borderColor={theme.colors.Gray}
      flexDirection="column"
      paddingY={1}
      paddingX={2}
    >
      <Text bold color={theme.colors.AccentPurple}>
        Stats
      </Text>

      <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
        <StatsColumn
          title="Last Turn"
          stats={lastTurnFormatted}
          width={COLUMN_WIDTH}
        />
        <StatsColumn
          title={`Cumulative (${stats.turnCount} Turns)`}
          stats={cumulativeFormatted}
          isCumulative={true}
          width={COLUMN_WIDTH}
        />
      </Box>

      <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
        {/* Left column for "Last Turn" duration */}
        <Box width={COLUMN_WIDTH} flexDirection="column">
          <StatRow
            label="Turn Duration (API)"
            value={formatDuration(lastTurnStats.apiTimeMs)}
          />
        </Box>

        {/* Right column for "Cumulative" durations */}
        <Box width={COLUMN_WIDTH} flexDirection="column">
          <StatRow
            label="Total duration (API)"
            value={formatDuration(stats.apiTimeMs)}
          />
          <StatRow label="Total duration (wall)" value={duration} />
        </Box>
      </Box>
    </Box>
  );
};
