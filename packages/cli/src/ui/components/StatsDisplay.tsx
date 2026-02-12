/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P06
 * @plan PLAN-20250909-TOKTRACK.P16
 * @requirement REQ-INT-001.2
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { Colors } from '../colors.js';
import { formatDuration } from '../utils/formatters.js';
import {
  formatTokensPerMinute,
  formatThrottleTime,
} from '../utils/tokenFormatters.js';
import { useSessionStats, ModelMetrics } from '../contexts/SessionContext.js';
import {
  getStatusColor,
  TOOL_SUCCESS_RATE_HIGH,
  TOOL_SUCCESS_RATE_MEDIUM,
  USER_AGREEMENT_RATE_HIGH,
  USER_AGREEMENT_RATE_MEDIUM,
} from '../utils/displayUtils.js';
import { computeSessionStats } from '../utils/computeStats.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import { ThemedGradient } from './ThemedGradient.js';

// A more flexible and powerful StatRow component
interface StatRowProps {
  title: string;
  children: React.ReactNode; // Use children to allow for complex, colored values
}

const StatRow: React.FC<StatRowProps> = ({ title, children }) => (
  <Box>
    {/* Fixed width for the label creates a clean "gutter" for alignment */}
    <Box width={28}>
      <Text color={theme.text.link}>{title}</Text>
    </Box>
    {/* FIX: Wrap children in a Box that can grow to fill remaining space */}
    <Box flexGrow={1}>{children}</Box>
  </Box>
);

// A SubStatRow for indented, secondary information
interface SubStatRowProps {
  title: string;
  children: React.ReactNode;
}

const SubStatRow: React.FC<SubStatRowProps> = ({ title, children }) => (
  <Box paddingLeft={2}>
    {/* Adjust width for the "» " prefix */}
    <Box width={26}>
      <Text color={theme.text.secondary}>» {title}</Text>
    </Box>
    {/* FIX: Apply the same flexGrow fix here */}
    <Box flexGrow={1}>{children}</Box>
  </Box>
);

// A Section component to group related stats
interface SectionProps {
  title: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, children }) => (
  <Box flexDirection="column" width="100%" marginBottom={1}>
    <Text bold color={theme.text.accent}>
      {title}
    </Text>
    {children}
  </Box>
);

const ModelUsageTable: React.FC<{
  models: Record<string, ModelMetrics>;
  totalCachedTokens: number;
  cacheEfficiency: number;
}> = ({ models, totalCachedTokens, cacheEfficiency }) => {
  const nameWidth = 25;
  const requestsWidth = 8;
  const inputTokensWidth = 15;
  const outputTokensWidth = 15;
  const tableWidth =
    nameWidth + requestsWidth + inputTokensWidth + outputTokensWidth;

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Header */}
      <Box>
        <Box width={nameWidth}>
          <Text bold color={theme.text.accent}>
            Model Usage
          </Text>
        </Box>
        <Box width={requestsWidth} justifyContent="flex-end">
          <Text bold color={theme.text.accent}>
            Reqs
          </Text>
        </Box>
        <Box width={inputTokensWidth} justifyContent="flex-end">
          <Text bold color={theme.text.accent}>
            Input Tokens
          </Text>
        </Box>
        <Box width={outputTokensWidth} justifyContent="flex-end">
          <Text bold color={theme.text.accent}>
            Output Tokens
          </Text>
        </Box>
      </Box>
      {/* Divider */}
      <Box width={tableWidth}>
        <Text color={theme.text.secondary}>{'─'.repeat(tableWidth)}</Text>
      </Box>

      {/* Rows */}
      {Object.entries(models).map(([name, modelMetrics]) => (
        <Box key={name}>
          <Box width={nameWidth}>
            <Text color={theme.text.primary}>{name.replace('-001', '')}</Text>
          </Box>
          <Box width={requestsWidth} justifyContent="flex-end">
            <Text color={theme.text.primary}>
              {modelMetrics.api.totalRequests}
            </Text>
          </Box>
          <Box width={inputTokensWidth} justifyContent="flex-end">
            <Text color={theme.status.warning}>
              {modelMetrics.tokens.prompt.toLocaleString()}
            </Text>
          </Box>
          <Box width={outputTokensWidth} justifyContent="flex-end">
            <Text color={theme.status.warning}>
              {modelMetrics.tokens.candidates.toLocaleString()}
            </Text>
          </Box>
        </Box>
      ))}
      {cacheEfficiency > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={Colors.Foreground}>
            <Text color={theme.status.success}>Savings Highlight:</Text>{' '}
            {totalCachedTokens.toLocaleString()} ({cacheEfficiency.toFixed(1)}
            %) of input tokens were served from the cache, reducing costs.
          </Text>
          <Box height={1} />
          <Text color={theme.text.secondary}>
            » Tip: For a full token breakdown, run `/stats model`.
          </Text>
        </Box>
      )}
    </Box>
  );
};

interface StatsDisplayProps {
  duration: string;
  title?: string;
}

export const StatsDisplay: React.FC<StatsDisplayProps> = ({
  duration,
  title,
}) => {
  const runtime = useRuntimeApi();
  const { stats } = useSessionStats();
  const { metrics } = stats;
  const { models, tools, files } = metrics;
  const computed = computeSessionStats(metrics);

  // Get token tracking metrics from provider manager
  const providerMetrics = runtime.getActiveProviderMetrics() ?? {
    tokensPerMinute: 0,
    throttleWaitTimeMs: 0,
    totalTokens: 0,
    totalRequests: 0,
  };
  const sessionUsage = runtime.getSessionTokenUsage();

  const successThresholds = {
    green: TOOL_SUCCESS_RATE_HIGH,
    yellow: TOOL_SUCCESS_RATE_MEDIUM,
  };
  const agreementThresholds = {
    green: USER_AGREEMENT_RATE_HIGH,
    yellow: USER_AGREEMENT_RATE_MEDIUM,
  };
  const successColor = getStatusColor(computed.successRate, successThresholds);
  const agreementColor = getStatusColor(
    computed.agreementRate,
    agreementThresholds,
  );

  const renderTitle = () => {
    if (title) {
      return theme.ui.gradient && theme.ui.gradient.length > 0 ? (
        <ThemedGradient colors={theme.ui.gradient}>
          <Text bold color={Colors.Foreground}>
            {title}
          </Text>
        </ThemedGradient>
      ) : (
        <Text bold color={theme.text.accent}>
          {title}
        </Text>
      );
    }
    return (
      <Text bold color={theme.text.accent}>
        Session Stats
      </Text>
    );
  };

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.default}
      flexDirection="column"
      paddingY={1}
      paddingX={2}
    >
      {renderTitle()}
      <Box height={1} />

      {(tools.totalCalls > 0 ||
        computed.totalDecisions > 0 ||
        (files &&
          (files.totalLinesAdded > 0 || files.totalLinesRemoved > 0))) && (
        <Section title="Interaction Summary">
          <StatRow title="Session ID:">
            <Text color={theme.text.primary}>{stats.sessionId}</Text>
          </StatRow>
          {tools.totalCalls > 0 && (
            <>
              <StatRow title="Tool Calls:">
                <Text color={theme.text.primary}>
                  {tools.totalCalls} ({' '}
                  <Text color={theme.status.success}>
                    ✓ {tools.totalSuccess}
                  </Text>{' '}
                  <Text color={theme.status.error}>x {tools.totalFail}</Text> )
                </Text>
              </StatRow>
              <StatRow title="Success Rate:">
                <Text color={successColor}>
                  {computed.successRate.toFixed(1)}%
                </Text>
              </StatRow>
            </>
          )}
          {computed.totalDecisions > 0 && (
            <StatRow title="User Agreement:">
              <Text color={agreementColor}>
                {computed.agreementRate.toFixed(1)}%{' '}
                <Text color={theme.text.secondary}>
                  ({computed.totalDecisions} reviewed)
                </Text>
              </Text>
            </StatRow>
          )}
          {files &&
            (files.totalLinesAdded > 0 || files.totalLinesRemoved > 0) && (
              <StatRow title="Code Changes:">
                <Text color={Colors.Foreground}>
                  <Text color={theme.status.success}>
                    +{files.totalLinesAdded}
                  </Text>{' '}
                  <Text color={theme.status.error}>
                    -{files.totalLinesRemoved}
                  </Text>
                </Text>
              </StatRow>
            )}
        </Section>
      )}

      <Section title="Performance">
        <StatRow title="Wall Time:">
          <Text color={theme.text.primary}>{duration}</Text>
        </StatRow>
        <StatRow title="Agent Active:">
          <Text color={theme.text.primary}>
            {formatDuration(computed.agentActiveTime)}
          </Text>
        </StatRow>
        <SubStatRow title="API Time:">
          <Text color={theme.text.primary}>
            {formatDuration(computed.totalApiTime)}{' '}
            <Text color={theme.text.secondary}>
              ({computed.apiTimePercent.toFixed(1)}%)
            </Text>
          </Text>
        </SubStatRow>
        <SubStatRow title="Tool Time:">
          <Text color={theme.text.primary}>
            {formatDuration(computed.totalToolTime)}{' '}
            <Text color={theme.text.secondary}>
              ({computed.toolTimePercent.toFixed(1)}%)
            </Text>
          </Text>
        </SubStatRow>
      </Section>

      {/* Token Tracking Section */}
      <Section title="Token Tracking">
        <StatRow title="Tokens Per Minute:">
          <Text color={theme.text.primary}>
            {formatTokensPerMinute(providerMetrics.tokensPerMinute || 0)}
          </Text>
        </StatRow>
        <StatRow title="Throttle Wait Time:">
          <Text color={theme.text.primary}>
            {formatThrottleTime(providerMetrics.throttleWaitTimeMs || 0)}
          </Text>
        </StatRow>
        <SubStatRow title="Session Token Usage:">
          <Text color={theme.text.primary}>
            {`Session Tokens - Input: ${sessionUsage.input.toLocaleString()}, Output: ${sessionUsage.output.toLocaleString()}, Cache: ${sessionUsage.cache.toLocaleString()}, Tool: ${sessionUsage.tool.toLocaleString()}, Thought: ${sessionUsage.thought.toLocaleString()}, Total: ${sessionUsage.total.toLocaleString()}`}
          </Text>
        </SubStatRow>
      </Section>

      {Object.keys(models).length > 0 && (
        <ModelUsageTable
          models={models}
          totalCachedTokens={computed.totalCachedTokens}
          cacheEfficiency={computed.cacheEfficiency}
        />
      )}
    </Box>
  );
};

/**
 * @plan PLAN-20250909-TOKTRACK.P05
 */
