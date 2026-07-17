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
) => inputTokens ?? Math.max(0, promptTokens - cachedTokens);

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
      const avgLatency =
        metrics.api.totalRequests > 0
          ? metrics.api.totalLatencyMs / metrics.api.totalRequests
          : 0;
      return {
        key: name,
        modelName,
        requests: metrics.api.totalRequests,
        errors: metrics.api.totalErrors,
        cachedTokens: cachedTokens.toLocaleString(),
        inputTokens: inputTokens.toLocaleString(),
        outputTokens: metrics.tokens.candidates.toLocaleString(),
        totalLatency: formatDuration(metrics.api.totalLatencyMs),
        avgLatency: formatDuration(avgLatency),
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
  errors: number;
  cachedTokens: string;
  inputTokens: string;
  outputTokens: string;
  totalLatency: string;
  avgLatency: string;
}

const ModelTableRow: React.FC<{ row: ModelRowData }> = ({ row }) => (
  <Box key={row.key} flexDirection="column">
    <Box>
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
    <Box paddingLeft={2}>
      <Text color={theme.text.secondary} wrap="truncate-end">
        Latency: {row.avgLatency} avg / {row.totalLatency} total
        {row.errors > 0 ? ` (${row.errors} errors)` : ''}
      </Text>
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
  tools: {
    totalCalls: number;
    totalSuccess: number;
    totalFail: number;
    totalCancelled: number;
    totalDurationMs: number;
  };
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
          <Text color={theme.status.success}>OK {tools.totalSuccess}</Text>{' '}
          <Text color={theme.status.error}>ERR {tools.totalFail}</Text>
          {tools.totalCancelled > 0 && (
            <>
              {' '}
              <Text color={theme.text.secondary}>
                CNL {tools.totalCancelled}
              </Text>
            </>
          )}
          {' )'}
        </Text>
      </StatRow>
      {tools.totalDurationMs > 0 && (
        <SubStatRow title="Total Duration:">
          <Text color={theme.text.primary}>
            {formatDuration(tools.totalDurationMs)}
          </Text>
        </SubStatRow>
      )}
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
  totalApiTime: number;
  apiTimePercent: number;
  totalToolTime: number;
  toolTimePercent: number;
  agentActiveTime: number;
  accumulatedWorkMs: number;
  tokensPerMinute: number;
  lastRequestTpm: number;
  timeToFirstToken: number | null;
  weightedAvgTtftMs: number | null;
  outputGenerationTps: number;
  lastOutputGenerationTps: number;
  effectiveInputTps: number;
  lastEffectiveInputTps: number;
  uncachedInputTps: number | null;
}

function formatThroughput(value: number): string {
  return value < 1000
    ? `${value.toFixed(2)} TPM`
    : `${(value / 1000).toFixed(2)}k TPM`;
}

const ThroughputRows: React.FC<{
  tokensPerMinute: number;
  lastRequestTpm: number;
}> = ({ tokensPerMinute, lastRequestTpm }) => (
  <>
    {Number.isFinite(tokensPerMinute) && tokensPerMinute > 0 && (
      <SubStatRow title="Throughput (TPM):">
        <Text color={theme.text.primary}>
          {formatThroughput(tokensPerMinute)}
          <Text color={theme.text.secondary}> (session weighted)</Text>
        </Text>
      </SubStatRow>
    )}
    {Number.isFinite(lastRequestTpm) && lastRequestTpm > 0 && (
      <SubStatRow title="Last Request TPM:">
        <Text color={theme.text.primary}>
          {formatThroughput(lastRequestTpm)}
        </Text>
      </SubStatRow>
    )}
  </>
);

const LatencyRows: React.FC<{
  timeToFirstToken: number | null;
  weightedAvgTtftMs: number | null;
}> = ({ timeToFirstToken, weightedAvgTtftMs }) => {
  if (timeToFirstToken === null || !Number.isFinite(timeToFirstToken)) {
    return null;
  }
  return (
    <SubStatRow title="TTFT (last):">
      <Text color={theme.text.primary}>{timeToFirstToken.toFixed(0)}ms</Text>
      {weightedAvgTtftMs !== null && Number.isFinite(weightedAvgTtftMs) && (
        <Text color={theme.text.secondary}>
          {' '}
          (avg: {weightedAvgTtftMs.toFixed(0)}ms)
        </Text>
      )}
    </SubStatRow>
  );
};

const RateRows: React.FC<{
  outputGenerationTps: number;
  lastOutputGenerationTps: number;
  effectiveInputTps: number;
  lastEffectiveInputTps: number;
  uncachedInputTps: number | null;
}> = ({
  outputGenerationTps,
  lastOutputGenerationTps,
  effectiveInputTps,
  lastEffectiveInputTps,
  uncachedInputTps,
}) => (
  <>
    {Number.isFinite(outputGenerationTps) && outputGenerationTps > 0 && (
      <SubStatRow title="Output Gen Rate:">
        <Text color={theme.text.primary}>
          {outputGenerationTps.toFixed(2)} tok/s
          <Text color={theme.text.secondary}> (session weighted)</Text>
          {lastOutputGenerationTps > 0 && (
            <Text color={theme.text.secondary}>
              {' '}
              (last: {lastOutputGenerationTps.toFixed(2)})
            </Text>
          )}
        </Text>
      </SubStatRow>
    )}
    {Number.isFinite(effectiveInputTps) && effectiveInputTps > 0 && (
      <SubStatRow title="Input Rate (eff):">
        <Text color={theme.text.primary}>
          {effectiveInputTps.toFixed(2)} tok/s
          <Text color={theme.text.secondary}> (ΣP/ΣTTFT)</Text>
          {lastEffectiveInputTps > 0 && (
            <Text color={theme.text.secondary}>
              {' '}
              (last: {lastEffectiveInputTps.toFixed(2)})
            </Text>
          )}
        </Text>
      </SubStatRow>
    )}
    {uncachedInputTps !== null && Number.isFinite(uncachedInputTps) && (
      <SubStatRow title="Uncached Input:">
        <Text color={theme.text.primary}>
          {uncachedInputTps.toFixed(2)} tok/s
          <Text color={theme.text.secondary}> (Σmax(0,P-C)/ΣTTFT)</Text>
        </Text>
      </SubStatRow>
    )}
  </>
);

const PerformanceSection: React.FC<PerformanceSectionProps> = ({
  duration,
  totalApiTime,
  apiTimePercent,
  totalToolTime,
  toolTimePercent,
  agentActiveTime,
  accumulatedWorkMs,
  tokensPerMinute,
  lastRequestTpm,
  timeToFirstToken,
  weightedAvgTtftMs,
  outputGenerationTps,
  lastOutputGenerationTps,
  effectiveInputTps,
  lastEffectiveInputTps,
  uncachedInputTps,
}) => (
  <Section title="Performance">
    <StatRow title="Wall Time:">
      <Text color={theme.text.primary}>{duration}</Text>
    </StatRow>
    {agentActiveTime > 0 && (
      <StatRow title="Agent Active:">
        <Text color={theme.text.primary}>
          {formatDuration(agentActiveTime)}
          <Text color={theme.text.secondary}> (interval union)</Text>
        </Text>
      </StatRow>
    )}
    {accumulatedWorkMs > 0 && (
      <StatRow title="Accumulated Work:">
        <Text color={theme.text.primary}>
          {formatDuration(accumulatedWorkMs)}
          <Text color={theme.text.secondary}> (API+Tool)</Text>
        </Text>
      </StatRow>
    )}
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
    <ThroughputRows
      tokensPerMinute={tokensPerMinute}
      lastRequestTpm={lastRequestTpm}
    />
    <LatencyRows
      timeToFirstToken={timeToFirstToken}
      weightedAvgTtftMs={weightedAvgTtftMs}
    />
    <RateRows
      outputGenerationTps={outputGenerationTps}
      lastOutputGenerationTps={lastOutputGenerationTps}
      effectiveInputTps={effectiveInputTps}
      lastEffectiveInputTps={lastEffectiveInputTps}
      uncachedInputTps={uncachedInputTps}
    />
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

function sumModelApi(
  models: Record<string, ModelMetrics>,
  field: 'totalRequests' | 'totalErrors' | 'totalLatencyMs',
): number {
  return Object.values(models).reduce((acc, m) => acc + m.api[field], 0);
}

const SessionApiSection: React.FC<{
  totalRequests: number;
  totalErrors: number;
  avgLatency: number;
}> = ({ totalRequests, totalErrors, avgLatency }) => {
  if (totalRequests <= 0) return null;
  return (
    <Section title="Session API">
      <StatRow title="Total Requests:">
        <Text color={theme.text.primary}>{totalRequests.toLocaleString()}</Text>
      </StatRow>
      <StatRow title="Total Errors:">
        <Text color={theme.text.primary}>{totalErrors.toLocaleString()}</Text>
      </StatRow>
      <StatRow title="Avg Latency:">
        <Text color={theme.text.primary}>{formatDuration(avgLatency)}</Text>
      </StatRow>
    </Section>
  );
};

export const StatsDisplay: React.FC<StatsDisplayProps> = ({
  duration,
  title,
  quotaLines,
}) => {
  const { stats } = useSessionStats();
  const { metrics } = stats;
  const { models, tools, files } = metrics;
  const computed = computeSessionStats(metrics);

  const totalSessionRequests = sumModelApi(models, 'totalRequests');
  const totalSessionErrors = sumModelApi(models, 'totalErrors');
  const totalSessionLatency = sumModelApi(models, 'totalLatencyMs');
  const avgLatency =
    totalSessionRequests > 0 ? totalSessionLatency / totalSessionRequests : 0;

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
      <SessionApiSection
        totalRequests={totalSessionRequests}
        totalErrors={totalSessionErrors}
        avgLatency={avgLatency}
      />
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
        totalApiTime={computed.totalApiTime}
        apiTimePercent={computed.apiTimePercent}
        totalToolTime={computed.totalToolTime}
        toolTimePercent={computed.toolTimePercent}
        agentActiveTime={metrics.timing.agentActiveTimeMs}
        accumulatedWorkMs={metrics.timing.accumulatedWorkMs}
        tokensPerMinute={metrics.timing.completeTokensPerMinute}
        lastRequestTpm={metrics.timing.lastRequestTpm}
        timeToFirstToken={
          metrics.timing.lastTtftMs ?? metrics.tokenTracking.timeToFirstToken
        }
        weightedAvgTtftMs={metrics.timing.weightedAvgTtftMs}
        outputGenerationTps={metrics.timing.outputGenerationTps}
        lastOutputGenerationTps={metrics.timing.lastOutputGenerationTps}
        effectiveInputTps={metrics.timing.effectiveInputTps}
        lastEffectiveInputTps={metrics.timing.lastEffectiveInputTps}
        uncachedInputTps={metrics.timing.uncachedInputTps}
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
