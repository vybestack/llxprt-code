/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import { themeManager } from '../themes/theme-manager.js';
import { formatDuration } from '../utils/formatters.js';
import { CumulativeStats } from '../contexts/SessionContext.js';
import { FormattedStats, StatRow, StatsColumn } from './Stats.js';

// --- Prop and Data Structures ---

interface SessionSummaryDisplayProps {
  stats: CumulativeStats;
  duration: string;
}

// --- Main Component ---

export const SessionSummaryDisplay: React.FC<SessionSummaryDisplayProps> = ({
  stats,
  duration,
}) => {
  const theme = themeManager.getActiveTheme();
  const cumulativeFormatted: FormattedStats = {
    inputTokens: stats.promptTokenCount,
    outputTokens: stats.candidatesTokenCount,
    toolUseTokens: stats.toolUsePromptTokenCount,
    thoughtsTokens: stats.thoughtsTokenCount,
    cachedTokens: stats.cachedContentTokenCount,
    totalTokens: stats.totalTokenCount,
  };

  const title = 'Agent powering down. Goodbye!';

  return (
    <Box
      borderStyle="round"
      borderColor={theme.colors.Gray}
      flexDirection="column"
      paddingY={1}
      paddingX={2}
      alignSelf="flex-start"
    >
      <Box marginBottom={1} flexDirection="column">
        {theme.colors.GradientColors ? (
          <Gradient colors={theme.colors.GradientColors}>
            <Text bold>{title}</Text>
          </Gradient>
        ) : (
          <Text bold color={theme.colors.Foreground}>{title}</Text>
        )}
      </Box>

      <Box marginTop={1}>
        <StatsColumn
          title={`Cumulative Stats (${stats.turnCount} Turns)`}
          stats={cumulativeFormatted}
          isCumulative={true}
        >
          <Box marginTop={1} flexDirection="column">
            <StatRow
              label="Total duration (API)"
              value={formatDuration(stats.apiTimeMs)}
            />
            <StatRow label="Total duration (wall)" value={duration} />
          </Box>
        </StatsColumn>
      </Box>
    </Box>
  );
};
