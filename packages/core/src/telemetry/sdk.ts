/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// TELEMETRY: Modified to support local file logging only - no data sent to Google
import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-node';
import {
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
} from '@opentelemetry/sdk-logs';
import {
  ConsoleMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import type { Config } from '../config/config.js';
import { SERVICE_NAME } from './constants.js';
import { initializeMetrics } from './metrics.js';
import {
  FileLogExporter,
  FileMetricExporter,
  FileSpanExporter,
} from './file-exporters.js';
import { debugLogger } from '../utils/debugLogger.js';

// For troubleshooting, set the log level to DiagLogLevel.DEBUG
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

let sdk: NodeSDK | undefined;
let telemetryInitialized = false;
let flushInProgress: Promise<void> | null = null;

export function isTelemetrySdkInitialized(): boolean {
  return telemetryInitialized;
}

export function initializeTelemetry(config: Config): void {
  // TELEMETRY: Modified to ONLY support local file logging - network exporters disabled
  if (telemetryInitialized || !config.getTelemetryEnabled()) {
    // Only output verbose logs when telemetry is enabled to avoid stdout spam
    if (process.env.VERBOSE === 'true' && config.getTelemetryEnabled()) {
      debugLogger.error(
        `[TELEMETRY] Skipping initialization: initialized=${telemetryInitialized}, enabled=${config.getTelemetryEnabled()}`,
      );
    }
    return;
  }

  if (process.env.VERBOSE === 'true') {
    debugLogger.error(
      `[TELEMETRY] Initializing with outfile: ${config.getTelemetryOutfile()}`,
    );
  }

  const resource = resourceFromAttributes({
    [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME,
    [SemanticResourceAttributes.SERVICE_VERSION]: process.version,
    'session.id': config.getSessionId(),
  });

  // SECURITY: OTLP/network endpoints are completely disabled to prevent data leakage
  // Only local file or console output is allowed
  const telemetryOutfile = config.getTelemetryOutfile();

  const spanExporter = telemetryOutfile
    ? new FileSpanExporter(telemetryOutfile)
    : new ConsoleSpanExporter();

  const logExporter = telemetryOutfile
    ? new FileLogExporter(telemetryOutfile)
    : new ConsoleLogRecordExporter();

  const metricReader = telemetryOutfile
    ? new PeriodicExportingMetricReader({
        exporter: new FileMetricExporter(telemetryOutfile),
        exportIntervalMillis: 10000,
      })
    : new PeriodicExportingMetricReader({
        exporter: new ConsoleMetricExporter(),
        exportIntervalMillis: 10000,
      });

  // Configure batch processors with shorter delays for faster writes
  // This ensures telemetry is written promptly, especially important for tests
  const spanProcessor = new BatchSpanProcessor(spanExporter, {
    scheduledDelayMillis: 100, // Export every 100ms instead of default 5000ms
    maxExportBatchSize: 10, // Export after 10 spans instead of default 512
    exportTimeoutMillis: 5000, // Shorter timeout for faster failure detection
  });

  const logProcessor = new BatchLogRecordProcessor(logExporter, {
    scheduledDelayMillis: 0, // Export immediately for tests - was 100ms
    maxExportBatchSize: 1, // Export after every single log - was 10
    exportTimeoutMillis: 5000,
  });

  sdk = new NodeSDK({
    resource,
    spanProcessors: [spanProcessor],
    logRecordProcessors: [logProcessor],
    metricReader,
    instrumentations: [new HttpInstrumentation()],
  });

  try {
    sdk.start();
    if (config.getDebugMode()) {
      debugLogger.log('OpenTelemetry SDK started successfully.');
    }
    telemetryInitialized = true;
    initializeMetrics(config);
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
  if (sdk == null) return;
  if (flushInProgress != null) return flushInProgress;

  flushInProgress = (async () => {
    try {
      // Feature-detect forceFlush on the SDK instance
      if (
        typeof (sdk as unknown as Record<string, unknown>).forceFlush ===
        'function'
      ) {
        await (
          sdk as unknown as { forceFlush: () => Promise<void> }
        ).forceFlush();
      }
    } catch {
      // Telemetry flush failures are non-fatal
    } finally {
      flushInProgress = null;
    }
  })();

  return flushInProgress;
}

export async function shutdownTelemetry(config: Config): Promise<void> {
  // TELEMETRY: Shutdown only affects local file writing
  if (!telemetryInitialized || sdk == null) {
    return;
  }
  try {
    await sdk.shutdown();
    if (config.getDebugMode()) {
      debugLogger.log('OpenTelemetry SDK shut down successfully.');
    }
  } catch (error) {
    debugLogger.error('Error shutting down SDK:', error);
  } finally {
    telemetryInitialized = false;
  }
}
