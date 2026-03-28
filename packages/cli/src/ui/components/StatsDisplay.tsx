/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { ThemedGradient } from './ThemedGradient.js';
import { theme } from '../semantic-colors.js';
import { formatDuration } from '../utils/formatters.js';
import type { ModelMetrics } from '../contexts/SessionContext.js';
import { useSessionStats } from '../contexts/SessionContext.js';
import {
  getStatusColor,
  TOOL_SUCCESS_RATE_HIGH,
  TOOL_SUCCESS_RATE_MEDIUM,
  USER_AGREEMENT_RATE_HIGH,
  USER_AGREEMENT_RATE_MEDIUM,
  CACHE_EFFICIENCY_HIGH,
  CACHE_EFFICIENCY_MEDIUM,
} from '../utils/displayUtils.js';
import { computeSessionStats } from '../utils/computeStats.js';

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
    {children}
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
    {children}
  </Box>
);

// A Section component to group related stats
interface SectionProps {
  title: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, children }) => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold color={theme.text.primary}>
      {title}
    </Text>
    {children}
  </Box>
);

// Logic for building the unified list of table rows
const buildModelRows = (models: Record<string, ModelMetrics>) => {
  const getBaseModelName = (name: string) => name.replace('-001', '');

  // Models with active usage
  const activeRows = Object.entries(models).map(
    ([name, metrics]: [string, ModelMetrics]) => {
      const modelName = getBaseModelName(name);
      const cachedTokens = metrics.tokens.cached;
      const promptTokens = metrics.tokens.prompt;
      // Use input if available, otherwise compute from prompt - cached
      const inputTokens = metrics.tokens.input ?? promptTokens - cachedTokens;
      return {
        key: name,
        modelName,
        requests: metrics.api.totalRequests,
        cachedTokens: cachedTokens.toLocaleString(),
        inputTokens: inputTokens.toLocaleString(),
        outputTokens: metrics.tokens.candidates.toLocaleString(),
      };
    },
  );

  return activeRows;
};

const ModelUsageTable: React.FC<{
  models: Record<string, ModelMetrics>;
  cacheEfficiency: number;
  totalCachedTokens: number;
}> = ({ models, cacheEfficiency, totalCachedTokens }) => {
  const rows = buildModelRows(models);

  if (rows.length === 0) {
    return null;
  }

  const nameWidth = 25;
  const requestsWidth = 7;
  const uncachedWidth = 15;
  const cachedWidth = 14;
  const outputTokensWidth = 15;

  const cacheEfficiencyColor = getStatusColor(cacheEfficiency, {
    green: CACHE_EFFICIENCY_HIGH,
    yellow: CACHE_EFFICIENCY_MEDIUM,
  });

  const totalWidth =
    nameWidth + requestsWidth + uncachedWidth + cachedWidth + outputTokensWidth;

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Header */}
      <Box alignItems="flex-end">
        <Box width={nameWidth}>
          <Text bold color={theme.text.primary} wrap="truncate-end">
            Model Usage
          </Text>
        </Box>
        <Box
          width={requestsWidth}
          flexDirection="column"
          alignItems="flex-end"
          flexShrink={0}
        >
          <Text bold color={theme.text.primary}>
            Reqs
          </Text>
        </Box>
        <Box
          width={uncachedWidth}
          flexDirection="column"
          alignItems="flex-end"
          flexShrink={0}
        >
          <Text bold color={theme.text.primary}>
            Input Tokens
          </Text>
        </Box>
        <Box
          width={cachedWidth}
          flexDirection="column"
          alignItems="flex-end"
          flexShrink={0}
        >
          <Text bold color={theme.text.primary}>
            Cache Reads
          </Text>
        </Box>
        <Box
          width={outputTokensWidth}
          flexDirection="column"
          alignItems="flex-end"
          flexShrink={0}
        >
          <Text bold color={theme.text.primary}>
            Output Tokens
          </Text>
        </Box>
      </Box>

      {/* Divider */}
      <Box
        borderStyle="round"
        borderBottom={true}
        borderTop={false}
        borderLeft={false}
        borderRight={false}
        borderColor={theme.border.default}
        width={totalWidth}
      ></Box>

      {rows.map((row) => (
        <Box key={row.key}>
          <Box width={nameWidth}>
            <Text color={theme.text.primary} wrap="truncate-end">
              {row.modelName}
            </Text>
          </Box>
          <Box
            width={requestsWidth}
            flexDirection="column"
            alignItems="flex-end"
            flexShrink={0}
          >
            <Text color={theme.text.primary}>{row.requests}</Text>
          </Box>
          <Box
            width={uncachedWidth}
            flexDirection="column"
            alignItems="flex-end"
            flexShrink={0}
          >
            <Text color={theme.text.primary}>{row.inputTokens}</Text>
          </Box>
          <Box
            width={cachedWidth}
            flexDirection="column"
            alignItems="flex-end"
            flexShrink={0}
          >
            <Text color={theme.text.secondary}>{row.cachedTokens}</Text>
          </Box>
          <Box
            width={outputTokensWidth}
            flexDirection="column"
            alignItems="flex-end"
            flexShrink={0}
          >
            <Text color={theme.text.primary}>{row.outputTokens}</Text>
          </Box>
        </Box>
      ))}

      {cacheEfficiency > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.text.primary}>
            <Text color={theme.status.success}>Savings Highlight:</Text>{' '}
            {totalCachedTokens.toLocaleString()} (
            <Text color={cacheEfficiencyColor}>
              {cacheEfficiency.toFixed(1)}%
            </Text>
            ) of input tokens were served from the cache, reducing costs.
          </Text>
        </Box>
      )}
    </Box>
  );
};

interface StatsDisplayProps {
  duration: string;
  title?: string;
  quotaLines?: string[];
}

export const StatsDisplay: React.FC<StatsDisplayProps> = ({
  duration,
  title,
  quotaLines,
}) => {
  const { stats } = useSessionStats();
  const { metrics } = stats;
  const { models, tools, files } = metrics;
  const computed = computeSessionStats(metrics);

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
      return <ThemedGradient>{title}</ThemedGradient>;
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
      overflow="hidden"
    >
      {renderTitle()}
      <Box height={1} />

      {tools.totalCalls > 0 && (
        <Section title="Interaction Summary">
          <StatRow title="Session ID:">
            <Text color={theme.text.primary}>{stats.sessionId}</Text>
          </StatRow>
          <StatRow title="Tool Calls:">
            <Text color={theme.text.primary}>
              {tools.totalCalls} ({' '}
              <Text color={theme.status.success}>✓ {tools.totalSuccess}</Text>{' '}
              <Text color={theme.status.error}>x {tools.totalFail}</Text> )
            </Text>
          </StatRow>
          <StatRow title="Success Rate:">
            <Text color={successColor}>{computed.successRate.toFixed(1)}%</Text>
          </StatRow>
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
                <Text color={theme.text.primary}>
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
        {Number.isFinite(metrics.tokenTracking.tokensPerMinute) &&
          metrics.tokenTracking.tokensPerMinute > 0 && (
            <SubStatRow title="Throughput:">
              <Text color={theme.text.primary}>
                {metrics.tokenTracking.tokensPerMinute < 1000
                  ? `${metrics.tokenTracking.tokensPerMinute.toFixed(2)} TPM`
                  : `${(metrics.tokenTracking.tokensPerMinute / 1000).toFixed(2)}k TPM`}
                <Text color={theme.text.secondary}> (input+output)</Text>
              </Text>
            </SubStatRow>
          )}
        {metrics.tokenTracking.timeToFirstToken !== null &&
          Number.isFinite(metrics.tokenTracking.timeToFirstToken) && (
            <SubStatRow title="TTFT (last):">
              <Text color={theme.text.primary}>
                {metrics.tokenTracking.timeToFirstToken.toFixed(0)}ms
              </Text>
            </SubStatRow>
          )}
        {Number.isFinite(metrics.tokenTracking.tokensPerSecond) &&
          metrics.tokenTracking.tokensPerSecond > 0 && (
            <SubStatRow title="Token Rate (avg):">
              <Text color={theme.text.primary}>
                {metrics.tokenTracking.tokensPerSecond.toFixed(2)} tok/s
                <Text color={theme.text.secondary}>
                  {' '}
                  (session input+output)
                </Text>
              </Text>
            </SubStatRow>
          )}
      </Section>
      <ModelUsageTable
        models={models}
        cacheEfficiency={computed.cacheEfficiency}
        totalCachedTokens={computed.totalCachedTokens}
      />
      {quotaLines && quotaLines.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={theme.text.primary}>
            Quota Information
          </Text>
          {quotaLines.map((line, index) => (
            <Text key={index} color={theme.text.secondary}>
              {line}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
};
