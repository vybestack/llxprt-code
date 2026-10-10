import { RootTelemetry } from './root-telemetry.js';
import { FileLogExporter, FileSpanExporter } from './file-exporters.js';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { diag, DiagLogLevel, type DiagLogger } from '@opentelemetry/api';
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  type HistogramMetricData,
  type MetricData,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import {
  initializeMetrics,
  recordApiResponseMetrics,
  recordToolCallMetrics,
} from './metrics.js';
import {
  METRIC_API_REQUEST_LATENCY,
  METRIC_TOOL_CALL_LATENCY,
} from './constants.js';
import type {
  ContentGeneratorConfig,
  TelemetryConfig,
} from '../internal/interfaces.js';

const INT_FLOATING_POINT_WARNING =
  'INT value type cannot accept a floating-point value';

/**
 * Fully typed structural config double. TelemetryConfig requires every getter,
 * so the double provides benign values for the members the metrics path never
 * reads; no type assertions needed.
 */
const testConfig: TelemetryConfig = {
  getSessionId: (): string => 'value-type-behavior-test',
  getTelemetryEnabled: (): boolean => true,
  getTelemetryLogPromptsEnabled: (): boolean => false,
  getTelemetryLogApiBodiesEnabled: (): boolean => false,
  getTelemetryLogApiBodyMaxChars: (): number => 4000,
  getTelemetryOutfileMaxBytes: (): number => 104857600,
  getTelemetryOutfileMaxFiles: (): number => 10,
  getTelemetryOutfile: (): string | undefined => undefined,
  getDebugMode: (): boolean => false,
  getConversationLoggingEnabled: (): boolean => false,
  getModel: (): string => 'test-model',
  getEmbeddingModel: (): string | undefined => undefined,
  getSandbox: (): unknown => undefined,
  getCoreTools: (): string[] | undefined => undefined,
  getApprovalMode: (): string => 'default',
  getContentGeneratorConfig: (): ContentGeneratorConfig | undefined =>
    undefined,
  getFileFilteringRespectGitIgnore: (): boolean => true,
  getMcpServers: (): Record<string, unknown> | undefined => undefined,
};

interface HistogramSummary {
  count: number;
  sum: number;
}

function isHistogramMetric(metric: MetricData): metric is HistogramMetricData {
  return metric.dataPointType === DataPointType.HISTOGRAM;
}

function summarizeHistogram(
  resourceMetrics: ResourceMetrics,
  metricName: string,
): HistogramSummary | undefined {
  const metric = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter((entry) => entry.descriptor.name === metricName)
    .find(isHistogramMetric);
  if (metric === undefined) return undefined;
  if (metric.dataPoints.length === 0) return undefined;
  const point = metric.dataPoints[0];
  return { count: point.value.count, sum: point.value.sum ?? 0 };
}

describe('latency histogram value types (real OpenTelemetry SDK)', () => {
  let selected: RootTelemetry;
  let exporter: InMemoryMetricExporter;
  let diagMessages: string[];

  beforeEach(async (): Promise<void> => {
    diagMessages = [];
    const capture = (message: string): void => {
      diagMessages.push(message);
    };
    const capturingLogger: DiagLogger = {
      error: capture,
      warn: capture,
      info: capture,
      debug: capture,
      verbose: capture,
    };
    diag.setLogger(capturingLogger, DiagLogLevel.WARN);

    const E = join(tmpdir(), 'llxprt-telemetry-listener');
    mkdirSync(E, { recursive: true });
    const file = join(
      mkdtempSync(join(E, 'fractional-metrics-')),
      'metrics.jsonl',
    );
    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    selected = await RootTelemetry.create(
      {
        enabled: true,
        sessionId: testConfig.getSessionId(),
        outfile: file,
        maxBytes: 1048576,
        maxFiles: 2,
      },
      () => ({
        meter: exporter,
        logger: new FileLogExporter(file),
        tracer: new FileSpanExporter(file),
      }),
    );
  });

  afterEach(async (): Promise<void> => {
    try {
      await selected.close();
    } finally {
      diag.disable();
    }
  });

  it('stores the exact fractional API request latency without an INT truncation warning', async (): Promise<void> => {
    await initializeMetrics(selected);
    recordApiResponseMetrics(selected, 'test-model', 823.5471);

    await selected.flush();
    const collection = exporter
      .getMetrics()
      .find((_entry, index, entries) => index === entries.length - 1);
    if (collection === undefined)
      throw new Error('Private meter did not export');
    const summary = summarizeHistogram(collection, METRIC_API_REQUEST_LATENCY);

    expect(summary?.count).toBe(1);
    expect(summary?.sum).toBe(823.5471);
    expect(
      diagMessages.some((message) =>
        message.includes(INT_FLOATING_POINT_WARNING),
      ),
    ).toBe(false);
  });

  it('stores the exact fractional tool call latency without an INT truncation warning', async (): Promise<void> => {
    await initializeMetrics(selected);
    recordToolCallMetrics(selected, 'test-tool', 17.25, true);

    await selected.flush();
    const collection = exporter
      .getMetrics()
      .find((_entry, index, entries) => index === entries.length - 1);
    if (collection === undefined)
      throw new Error('Private meter did not export');
    const summary = summarizeHistogram(collection, METRIC_TOOL_CALL_LATENCY);

    expect(summary?.count).toBe(1);
    expect(summary?.sum).toBe(17.25);
    expect(
      diagMessages.some((message) =>
        message.includes(INT_FLOATING_POINT_WARNING),
      ),
    ).toBe(false);
  });
});
