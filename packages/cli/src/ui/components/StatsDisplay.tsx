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

const getInputTokens = (
  inputTokens: number | undefined,
  promptTokens: number,
  cachedTokens: number,
) => inputTokens ?? promptTokens - cachedTokens;

const hasCodeChanges = (
  files:
    | {
        totalLinesAdded: number;
        totalLinesRemoved: number;
      }
    | undefined,
) =>
  files !== undefined &&
  (files.totalLinesAdded > 0 || files.totalLinesRemoved > 0);

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
      const inputTokens = getInputTokens(
        metrics.tokens.input,
        promptTokens,
        cachedTokens,
      );
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

const MODEL_TABLE_WIDTHS = {
  name: 25,
  requests: 7,
  uncached: 15,
  cached: 14,
  output: 15,
} as const;

const ModelTableHeader: React.FC = () => (
  <Box alignItems="flex-end">
    <Box width={MODEL_TABLE_WIDTHS.name}>
      <Text bold color={theme.text.primary} wrap="truncate-end">
        Model Usage
      </Text>
    </Box>
    <Box
      width={MODEL_TABLE_WIDTHS.requests}
      flexDirection="column"
      alignItems="flex-end"
      flexShrink={0}
    >
      <Text bold color={theme.text.primary}>
        Reqs
      </Text>
    </Box>
    <Box
      width={MODEL_TABLE_WIDTHS.uncached}
      flexDirection="column"
      alignItems="flex-end"
      flexShrink={0}
    >
      <Text bold color={theme.text.primary}>
        Input Tokens
      </Text>
    </Box>
    <Box
      width={MODEL_TABLE_WIDTHS.cached}
      flexDirection="column"
      alignItems="flex-end"
      flexShrink={0}
    >
      <Text bold color={theme.text.primary}>
        Cache Reads
      </Text>
    </Box>
    <Box
      width={MODEL_TABLE_WIDTHS.output}
      flexDirection="column"
      alignItems="flex-end"
      flexShrink={0}
    >
      <Text bold color={theme.text.primary}>
        Output Tokens
      </Text>
    </Box>
  </Box>
);

interface ModelRowData {
  key: string;
  modelName: string;
  requests: number;
  cachedTokens: string;
  inputTokens: string;
  outputTokens: string;
}

const ModelTableRow: React.FC<{ row: ModelRowData }> = ({ row }) => (
  <Box key={row.key}>
    <Box width={MODEL_TABLE_WIDTHS.name}>
      <Text color={theme.text.primary} wrap="truncate-end">
        {row.modelName}
      </Text>
    </Box>
    <Box
      width={MODEL_TABLE_WIDTHS.requests}
      flexDirection="column"
      alignItems="flex-end"
      flexShrink={0}
    >
      <Text color={theme.text.primary}>{row.requests}</Text>
    </Box>
    <Box
      width={MODEL_TABLE_WIDTHS.uncached}
      flexDirection="column"
      alignItems="flex-end"
      flexShrink={0}
    >
      <Text color={theme.text.primary}>{row.inputTokens}</Text>
    </Box>
    <Box
      width={MODEL_TABLE_WIDTHS.cached}
      flexDirection="column"
      alignItems="flex-end"
      flexShrink={0}
    >
      <Text color={theme.text.secondary}>{row.cachedTokens}</Text>
    </Box>
    <Box
      width={MODEL_TABLE_WIDTHS.output}
      flexDirection="column"
      alignItems="flex-end"
      flexShrink={0}
    >
      <Text color={theme.text.primary}>{row.outputTokens}</Text>
    </Box>
  </Box>
);

const CacheSavingsHighlight: React.FC<{
  cacheEfficiency: number;
  totalCachedTokens: number;
}> = ({ cacheEfficiency, totalCachedTokens }) => {
  if (cacheEfficiency <= 0) return null;
  const cacheEfficiencyColor = getStatusColor(cacheEfficiency, {
    green: CACHE_EFFICIENCY_HIGH,
    yellow: CACHE_EFFICIENCY_MEDIUM,
  });
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.text.primary}>
        <Text color={theme.status.success}>Savings Highlight:</Text>{' '}
        {totalCachedTokens.toLocaleString()} (
        <Text color={cacheEfficiencyColor}>{cacheEfficiency.toFixed(1)}%</Text>)
        of input tokens were served from the cache, reducing costs.
      </Text>
    </Box>
  );
};

const ModelUsageTable: React.FC<{
  models: Record<string, ModelMetrics>;
  cacheEfficiency: number;
  totalCachedTokens: number;
}> = ({ models, cacheEfficiency, totalCachedTokens }) => {
  const rows = buildModelRows(models);
  if (rows.length === 0) return null;

  const totalWidth =
    MODEL_TABLE_WIDTHS.name +
    MODEL_TABLE_WIDTHS.requests +
    MODEL_TABLE_WIDTHS.uncached +
    MODEL_TABLE_WIDTHS.cached +
    MODEL_TABLE_WIDTHS.output;

  return (
    <Box flexDirection="column" marginTop={1}>
      <ModelTableHeader />
      <Box
        borderStyle="round"
        borderBottom={true}
        borderTop={false}
        borderLeft={false}
        borderRight={false}
        borderColor={theme.border.default}
        width={totalWidth}
      />
      {rows.map((row) => (
        <ModelTableRow key={row.key} row={row} />
      ))}
      <CacheSavingsHighlight
        cacheEfficiency={cacheEfficiency}
        totalCachedTokens={totalCachedTokens}
      />
    </Box>
  );
};

interface InteractionSummaryProps {
  sessionId: string;
  tools: { totalCalls: number; totalSuccess: number; totalFail: number };
  files: { totalLinesAdded: number; totalLinesRemoved: number } | undefined;
  successRate: number;
  agreementRate: number;
  totalDecisions: number;
}

const InteractionSummary: React.FC<InteractionSummaryProps> = ({
  sessionId,
  tools,
  files,
  successRate,
  agreementRate,
  totalDecisions,
}) => {
  const successColor = getStatusColor(successRate, {
    green: TOOL_SUCCESS_RATE_HIGH,
    yellow: TOOL_SUCCESS_RATE_MEDIUM,
  });
  const agreementColor = getStatusColor(agreementRate, {
    green: USER_AGREEMENT_RATE_HIGH,
    yellow: USER_AGREEMENT_RATE_MEDIUM,
  });

  return (
    <Section title="Interaction Summary">
      <StatRow title="Session ID:">
        <Text color={theme.text.primary}>{sessionId}</Text>
      </StatRow>
      <StatRow title="Tool Calls:">
        <Text color={theme.text.primary}>
          {tools.totalCalls} ({' '}
          <Text color={theme.status.success}>✓ {tools.totalSuccess}</Text>{' '}
          <Text color={theme.status.error}>x {tools.totalFail}</Text> )
        </Text>
      </StatRow>
      <StatRow title="Success Rate:">
        <Text color={successColor}>{successRate.toFixed(1)}%</Text>
      </StatRow>
      {totalDecisions > 0 && (
        <StatRow title="User Agreement:">
          <Text color={agreementColor}>
            {agreementRate.toFixed(1)}%{' '}
            <Text color={theme.text.secondary}>
              ({totalDecisions} reviewed)
            </Text>
          </Text>
        </StatRow>
      )}
      {hasCodeChanges(files) && (
        <StatRow title="Code Changes:">
          <Text color={theme.text.primary}>
            <Text color={theme.status.success}>+{files!.totalLinesAdded}</Text>{' '}
            <Text color={theme.status.error}>-{files!.totalLinesRemoved}</Text>
          </Text>
        </StatRow>
      )}
    </Section>
  );
};

interface PerformanceSectionProps {
  duration: string;
  agentActiveTime: number;
  totalApiTime: number;
  apiTimePercent: number;
  totalToolTime: number;
  toolTimePercent: number;
  tokensPerMinute: number;
  timeToFirstToken: number | null;
  tokensPerSecond: number;
}

const PerformanceSection: React.FC<PerformanceSectionProps> = ({
  duration,
  agentActiveTime,
  totalApiTime,
  apiTimePercent,
  totalToolTime,
  toolTimePercent,
  tokensPerMinute,
  timeToFirstToken,
  tokensPerSecond,
}) => (
  <Section title="Performance">
    <StatRow title="Wall Time:">
      <Text color={theme.text.primary}>{duration}</Text>
    </StatRow>
    <StatRow title="Agent Active:">
      <Text color={theme.text.primary}>{formatDuration(agentActiveTime)}</Text>
    </StatRow>
    <SubStatRow title="API Time:">
      <Text color={theme.text.primary}>
        {formatDuration(totalApiTime)}{' '}
        <Text color={theme.text.secondary}>({apiTimePercent.toFixed(1)}%)</Text>
      </Text>
    </SubStatRow>
    <SubStatRow title="Tool Time:">
      <Text color={theme.text.primary}>
        {formatDuration(totalToolTime)}{' '}
        <Text color={theme.text.secondary}>
          ({toolTimePercent.toFixed(1)}%)
        </Text>
      </Text>
    </SubStatRow>
    {Number.isFinite(tokensPerMinute) && tokensPerMinute > 0 && (
      <SubStatRow title="Throughput:">
        <Text color={theme.text.primary}>
          {tokensPerMinute < 1000
            ? `${tokensPerMinute.toFixed(2)} TPM`
            : `${(tokensPerMinute / 1000).toFixed(2)}k TPM`}
          <Text color={theme.text.secondary}> (input+output)</Text>
        </Text>
      </SubStatRow>
    )}
    {timeToFirstToken !== null && Number.isFinite(timeToFirstToken) && (
      <SubStatRow title="TTFT (last):">
        <Text color={theme.text.primary}>{timeToFirstToken.toFixed(0)}ms</Text>
      </SubStatRow>
    )}
    {Number.isFinite(tokensPerSecond) && tokensPerSecond > 0 && (
      <SubStatRow title="Token Rate (avg):">
        <Text color={theme.text.primary}>
          {tokensPerSecond.toFixed(2)} tok/s
          <Text color={theme.text.secondary}> (session input+output)</Text>
        </Text>
      </SubStatRow>
    )}
  </Section>
);

const QuotaInfo: React.FC<{ quotaLines: string[] }> = ({ quotaLines }) => (
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
);

interface StatsDisplayProps {
  duration: string;
  title?: string;
  quotaLines?: string[];
}

const StatsTitle: React.FC<{ title?: string }> = ({ title }) =>
  title ? (
    <ThemedGradient>{title}</ThemedGradient>
  ) : (
    <Text bold color={theme.text.accent}>
      Session Stats
    </Text>
  );

export const StatsDisplay: React.FC<StatsDisplayProps> = ({
  duration,
  title,
  quotaLines,
}) => {
  const { stats } = useSessionStats();
  const { metrics } = stats;
  const { models, tools, files } = metrics;
  const computed = computeSessionStats(metrics);

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.default}
      flexDirection="column"
      paddingY={1}
      paddingX={2}
      overflow="hidden"
    >
      <StatsTitle title={title} />
      <Box height={1} />
      {tools.totalCalls > 0 && (
        <InteractionSummary
          sessionId={stats.sessionId}
          tools={tools}
          files={files}
          successRate={computed.successRate}
          agreementRate={computed.agreementRate}
          totalDecisions={computed.totalDecisions}
        />
      )}
      <PerformanceSection
        duration={duration}
        agentActiveTime={computed.agentActiveTime}
        totalApiTime={computed.totalApiTime}
        apiTimePercent={computed.apiTimePercent}
        totalToolTime={computed.totalToolTime}
        toolTimePercent={computed.toolTimePercent}
        tokensPerMinute={metrics.tokenTracking.tokensPerMinute}
        timeToFirstToken={metrics.tokenTracking.timeToFirstToken}
        tokensPerSecond={metrics.tokenTracking.tokensPerSecond}
      />
      <ModelUsageTable
        models={models}
        cacheEfficiency={computed.cacheEfficiency}
        totalCachedTokens={computed.totalCachedTokens}
      />
      {quotaLines && quotaLines.length > 0 && (
        <QuotaInfo quotaLines={quotaLines} />
      )}
    </Box>
  );
};
