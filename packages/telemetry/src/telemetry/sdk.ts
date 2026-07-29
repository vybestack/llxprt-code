/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  context,
  DiagConsoleLogger,
  DiagLogLevel,
  diag,
  metrics,
  propagation,
  trace,
} from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  NodeTracerProvider,
} from '@opentelemetry/sdk-trace-node';
import {
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
  LoggerProvider,
} from '@opentelemetry/sdk-logs';
import {
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import type { TelemetryConfig } from '../internal/interfaces.js';
import { SERVICE_NAME } from './constants.js';
import { initializeMetrics, resetMetricsState } from './metrics.js';
import {
  FileLogExporter,
  FileMetricExporter,
  FileSpanExporter,
} from './file-exporters.js';
import { debugLogger } from '../utils/debugLogger.js';

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

interface TelemetryProviders {
  tracer: NodeTracerProvider;
  logger: LoggerProvider;
  meter: MeterProvider;
}

const httpInstrumentation = new HttpInstrumentation();
let providers: TelemetryProviders | undefined;
let telemetryInitialized = false;
let shuttingDown = false;
let flushInProgress: Promise<void> | null = null;

export function isTelemetrySdkInitialized(): boolean {
  return telemetryInitialized;
}

function createProviders(config: TelemetryConfig): TelemetryProviders {
  const resource = resourceFromAttributes({
    [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME,
    [SemanticResourceAttributes.SERVICE_VERSION]: process.version,
    'session.id': config.getSessionId(),
  });
  const telemetryOutfile = config.getTelemetryOutfile() ?? '';
  const spanExporter = telemetryOutfile
    ? new FileSpanExporter(telemetryOutfile)
    : new ConsoleSpanExporter();
  const logExporter = telemetryOutfile
    ? new FileLogExporter(telemetryOutfile)
    : new ConsoleLogRecordExporter();
  const metricExporter = telemetryOutfile
    ? new FileMetricExporter(telemetryOutfile)
    : new ConsoleMetricExporter();

  return {
    tracer: new NodeTracerProvider({
      resource,
      spanProcessors: [
        new BatchSpanProcessor(spanExporter, {
          scheduledDelayMillis: 100,
          maxExportBatchSize: 10,
          exportTimeoutMillis: 5000,
        }),
      ],
    }),
    logger: new LoggerProvider({
      resource,
      processors: [
        new BatchLogRecordProcessor(logExporter, {
          scheduledDelayMillis: 0,
          maxExportBatchSize: 1,
          exportTimeoutMillis: 5000,
        }),
      ],
    }),
    meter: new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: metricExporter,
          exportIntervalMillis: 10000,
          exportTimeoutMillis: 5000,
        }),
      ],
    }),
  };
}

function registerProviders(nextProviders: TelemetryProviders): void {
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
      ],
    }),
  );
  trace.setGlobalTracerProvider(nextProviders.tracer);
  logs.setGlobalLoggerProvider(nextProviders.logger);
  metrics.setGlobalMeterProvider(nextProviders.meter);
  httpInstrumentation.setTracerProvider(nextProviders.tracer);
  httpInstrumentation.setMeterProvider(nextProviders.meter);
  httpInstrumentation.enable();
}

export function initializeTelemetry(config: TelemetryConfig): void {
  if (telemetryInitialized || shuttingDown || !config.getTelemetryEnabled()) {
    if (process.env.VERBOSE === 'true' && config.getTelemetryEnabled()) {
      debugLogger.log(
        `[TELEMETRY] Skipping initialization: initialized=${telemetryInitialized}, enabled=${config.getTelemetryEnabled()}`,
      );
    }
    return;
  }

  if (process.env.VERBOSE === 'true') {
    debugLogger.log(
      `[TELEMETRY] Initializing with outfile: ${config.getTelemetryOutfile()}`,
    );
  }

  try {
    const nextProviders = createProviders(config);
    registerProviders(nextProviders);
    providers = nextProviders;
    telemetryInitialized = true;
    initializeMetrics(config);
    if (config.getDebugMode()) {
      debugLogger.log('OpenTelemetry SDK started successfully.');
    }
  } catch (error) {
    debugLogger.error('Error starting OpenTelemetry SDK:', error);
  }

  process.on('SIGTERM', () => {
    void shutdownTelemetry(config);
  });
  process.on('SIGINT', () => {
    void shutdownTelemetry(config);
  });
}

export async function flushTelemetry(): Promise<void> {
  if (!providers) return;
  if (flushInProgress) {
    await flushInProgress;
    return;
  }

  flushInProgress = Promise.all([
    providers.tracer.forceFlush(),
    providers.logger.forceFlush(),
    providers.meter.forceFlush(),
  ])
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      flushInProgress = null;
    });

  await flushInProgress;
}

export async function shutdownTelemetry(
  config: TelemetryConfig,
): Promise<void> {
  if (!telemetryInitialized || !providers || shuttingDown) {
    return;
  }

  shuttingDown = true;
  const activeProviders = providers;
  providers = undefined;
  telemetryInitialized = false;
  try {
    await Promise.all([
      activeProviders.tracer.shutdown(),
      activeProviders.logger.shutdown(),
      activeProviders.meter.shutdown(),
    ]);
    if (config.getDebugMode()) {
      debugLogger.log('OpenTelemetry SDK shut down successfully.');
    }
  } catch (error) {
    debugLogger.error('Error shutting down SDK:', error);
  } finally {
    httpInstrumentation.disable();
    context.disable();
    propagation.disable();
    trace.disable();
    logs.disable();
    metrics.disable();
    resetMetricsState();
    shuttingDown = false;
  }
}
