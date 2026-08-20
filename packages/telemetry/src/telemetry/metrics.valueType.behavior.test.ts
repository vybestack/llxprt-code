/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  diag,
  DiagLogLevel,
  metrics,
  type DiagLogger,
} from '@opentelemetry/api';
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type HistogramMetricData,
  type MetricData,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import {
  initializeMetrics,
  recordApiResponseMetrics,
  recordToolCallMetrics,
  resetMetricsState,
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
  const point = metric.dataPoints.at(0);
  if (point === undefined) return undefined;
  return { count: point.value.count, sum: point.value.sum ?? 0 };
}

describe('latency histogram value types (real OpenTelemetry SDK)', () => {
  let meterProvider: MeterProvider;
  let reader: PeriodicExportingMetricReader;
  let diagMessages: string[];

  beforeEach((): void => {
    resetMetricsState();
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

    reader = new PeriodicExportingMetricReader({
      exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    });
    meterProvider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(meterProvider);
  });

  afterEach(async (): Promise<void> => {
    resetMetricsState();
    await meterProvider.shutdown();
    metrics.disable();
    diag.disable();
  });

  it('stores the exact fractional API request latency without an INT truncation warning', async (): Promise<void> => {
    initializeMetrics(testConfig);
    recordApiResponseMetrics(testConfig, 'test-model', 823.5471);

    const collection = await reader.collect();
    const summary = summarizeHistogram(
      collection.resourceMetrics,
      METRIC_API_REQUEST_LATENCY,
    );

    expect(summary?.count).toBe(1);
    expect(summary?.sum).toBe(823.5471);
    expect(
      diagMessages.some((message) =>
        message.includes(INT_FLOATING_POINT_WARNING),
      ),
    ).toBe(false);
  });

  it('stores the exact fractional tool call latency without an INT truncation warning', async (): Promise<void> => {
    initializeMetrics(testConfig);
    recordToolCallMetrics(testConfig, 'test-tool', 17.25, true);

    const collection = await reader.collect();
    const summary = summarizeHistogram(
      collection.resourceMetrics,
      METRIC_TOOL_CALL_LATENCY,
    );

    expect(summary?.count).toBe(1);
    expect(summary?.sum).toBe(17.25);
    expect(
      diagMessages.some((message) =>
        message.includes(INT_FLOATING_POINT_WARNING),
      ),
    ).toBe(false);
  });
});
