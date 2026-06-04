/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { formatDuration } from '../utils/formatters.js';
import {
  calculateAverageLatency,
  calculateCacheHitRate,
  calculateErrorRate,
} from '../utils/computeStats.js';
import {
  useSessionStats,
  type SessionMetrics,
} from '../contexts/SessionContext.js';
import { Table, type Column } from './Table.js';

interface StatRowData {
  metric: string;
  isSection?: boolean;
  isSubtle?: boolean;
  [key: string]: string | React.ReactNode | boolean | undefined;
}

type ModelMetrics = SessionMetrics['models'][string];
type ActiveModelEntry = [string, ModelMetrics];

function createStatRow(
  activeModels: ActiveModelEntry[],
  metric: string,
  getValue: (metrics: ModelMetrics) => string | React.ReactNode,
  options: { isSection?: boolean; isSubtle?: boolean } = {},
): StatRowData {
  const row: StatRowData = {
    metric,
    isSection: options.isSection,
    isSubtle: options.isSubtle,
  };
  activeModels.forEach(([name, metrics]) => {
    row[name] = getValue(metrics);
  });
  return row;
}

function buildApiSectionRows(activeModels: ActiveModelEntry[]): StatRowData[] {
  return [
    { metric: 'API', isSection: true },
    createStatRow(activeModels, 'Requests', (m) =>
      m.api.totalRequests.toLocaleString(),
    ),
    createStatRow(activeModels, 'Errors', (m) => {
      const errorRate = calculateErrorRate(m);
      return (
        <Text
          color={
            m.api.totalErrors > 0 ? theme.status.error : theme.text.primary
          }
        >
          {m.api.totalErrors.toLocaleString()} ({errorRate.toFixed(1)}%)
        </Text>
      );
    }),
    createStatRow(activeModels, 'Avg Latency', (m) =>
      formatDuration(calculateAverageLatency(m)),
    ),
    { metric: '' },
    { metric: 'Tokens', isSection: true },
  ];
}

function buildBaseTokenRows(activeModels: ActiveModelEntry[]): StatRowData[] {
  return [
    createStatRow(activeModels, 'Total', (m) => (
      <Text color={theme.text.secondary}>
        {m.tokens.total.toLocaleString()}
      </Text>
    )),
    createStatRow(
      activeModels,
      'Input',
      (m) => (
        <Text color={theme.text.primary}>
          {m.tokens.input.toLocaleString()}
        </Text>
      ),
      { isSubtle: true },
    ),
  ];
}

function buildOptionalTokenRows(
  activeModels: ActiveModelEntry[],
  hasCached: boolean,
  hasThoughts: boolean,
  hasTool: boolean,
): StatRowData[] {
  const rows: StatRowData[] = [];
  if (hasCached) {
    rows.push(
      createStatRow(
        activeModels,
        'Cache Reads',
        (m) => {
          const cacheHitRate = calculateCacheHitRate(m);
          return (
            <Text color={theme.text.secondary}>
              {m.tokens.cached.toLocaleString()} ({cacheHitRate.toFixed(1)}%)
            </Text>
          );
        },
        { isSubtle: true },
      ),
    );
  }
  if (hasThoughts) {
    rows.push(
      createStatRow(
        activeModels,
        'Thoughts',
        (m) => (
          <Text color={theme.text.primary}>
            {m.tokens.thoughts.toLocaleString()}
          </Text>
        ),
        { isSubtle: true },
      ),
    );
  }
  if (hasTool) {
    rows.push(
      createStatRow(
        activeModels,
        'Tool',
        (m) => (
          <Text color={theme.text.primary}>
            {m.tokens.tool.toLocaleString()}
          </Text>
        ),
        { isSubtle: true },
      ),
    );
  }
  return rows;
}

function buildTokenRows(
  activeModels: ActiveModelEntry[],
  hasCached: boolean,
  hasThoughts: boolean,
  hasTool: boolean,
): StatRowData[] {
  const rows = buildBaseTokenRows(activeModels);
  rows.push(
    ...buildOptionalTokenRows(activeModels, hasCached, hasThoughts, hasTool),
  );
  rows.push(
    createStatRow(
      activeModels,
      'Output',
      (m) => (
        <Text color={theme.text.primary}>
          {m.tokens.candidates.toLocaleString()}
        </Text>
      ),
      { isSubtle: true },
    ),
  );
  return rows;
}

function buildColumns(modelNames: string[]): Array<Column<StatRowData>> {
  return [
    {
      key: 'metric',
      header: 'Metric',
      width: 28,
      renderCell: (row) => (
        <Text
          bold={row.isSection === true}
          color={row.isSection === true ? theme.text.primary : theme.text.link}
        >
          {row.isSubtle === true ? `  ↳ ${row.metric}` : row.metric}
        </Text>
      ),
    },
    ...modelNames.map((name) => ({
      key: name,
      header: name,
      flexGrow: 1,
      renderCell: (row: StatRowData) => {
        if (row.isSection === true) return null;
        const val = row[name];
        if (val === undefined || val === null) return null;
        if (typeof val === 'string' || typeof val === 'number') {
          return <Text color={theme.text.primary}>{val}</Text>;
        }
        return val as React.ReactNode;
      },
    })),
  ];
}

export const ModelStatsDisplay: React.FC = () => {
  const { stats } = useSessionStats();
  const { models } = stats.metrics;
  const activeModels = Object.entries(models).filter(
    ([, metrics]) => metrics.api.totalRequests > 0,
  ) as ActiveModelEntry[];

  if (activeModels.length === 0) {
    return (
      <Box
        borderStyle="round"
        borderColor={theme.border.default}
        paddingY={1}
        paddingX={2}
      >
        <Text color={theme.text.primary}>
          No API calls have been made in this session.
        </Text>
      </Box>
    );
  }

  const modelNames = activeModels.map(([name]) => name);
  const hasThoughts = activeModels.some(
    ([, metrics]) => metrics.tokens.thoughts > 0,
  );
  const hasTool = activeModels.some(([, metrics]) => metrics.tokens.tool > 0);
  const hasCached = activeModels.some(
    ([, metrics]) => metrics.tokens.cached > 0,
  );

  const rows = [
    ...buildApiSectionRows(activeModels),
    ...buildTokenRows(activeModels, hasCached, hasThoughts, hasTool),
  ];
  const columns = buildColumns(modelNames);

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.default}
      flexDirection="column"
      paddingY={1}
      paddingX={2}
    >
      <Text bold color={theme.text.accent}>
        Model Stats For Nerds
      </Text>
      <Box height={1} />
      <Table data={rows} columns={columns} />
    </Box>
  );
};
