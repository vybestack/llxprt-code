/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { StatsDisplay } from './StatsDisplay.js';

interface SessionSummaryDisplayProps {
  duration: string;
  /** Canonical final snapshot cloned at quit time */
  totalApiRequests?: number;
  totalTokens?: number;
  completeTokensPerMinute?: number;
  totalToolCalls?: number;
}

function hasSummaryData(props: SessionSummaryDisplayProps): boolean {
  return (
    props.totalApiRequests !== undefined ||
    props.totalTokens !== undefined ||
    props.completeTokensPerMinute !== undefined ||
    props.totalToolCalls !== undefined
  );
}

export const SessionSummaryDisplay: React.FC<SessionSummaryDisplayProps> = (
  props,
) => {
  const {
    duration,
    totalApiRequests,
    totalTokens,
    completeTokensPerMinute,
    totalToolCalls,
  } = props;
  return (
    <>
      <StatsDisplay title="Agent powering down. Goodbye!" duration={duration} />
      {hasSummaryData(props) && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={theme.text.accent}>
            Final Session Summary
          </Text>
          {totalApiRequests !== undefined && (
            <Text color={theme.text.primary}>
              API Requests: {totalApiRequests.toLocaleString()}
            </Text>
          )}
          {totalTokens !== undefined && (
            <Text color={theme.text.primary}>
              Total Tokens: {totalTokens.toLocaleString()}
            </Text>
          )}
          {completeTokensPerMinute !== undefined && (
            <Text color={theme.text.primary}>
              Completed TPM:{' '}
              {Number.isFinite(completeTokensPerMinute)
                ? completeTokensPerMinute.toFixed(2)
                : '—'}
            </Text>
          )}
          {totalToolCalls !== undefined && (
            <Text color={theme.text.primary}>
              Tool Calls: {totalToolCalls.toLocaleString()}
            </Text>
          )}
        </Box>
      )}
    </>
  );
};
