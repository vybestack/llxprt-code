/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// TELEMETRY: Modified to support local file logging only - no data sent to Google
import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
// TELEMETRY REMOVED: Network exporters disabled to prevent sending data to Google
// import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
// import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
// import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
// import { CompressionAlgorithm } from '@opentelemetry/otlp-exporter-base';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { Resource } from '@opentelemetry/resources';
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
import { Config } from '../config/config.js';
import { SERVICE_NAME } from './constants.js';
import { initializeMetrics } from './metrics.js';
// TELEMETRY REMOVED: ClearcutLogger disabled to prevent sending data to Google
// import { ClearcutLogger } from './clearcut-logger/clearcut-logger.js';
import {
  FileLogExporter,
  FileMetricExporter,
  FileSpanExporter,
} from './file-exporters.js';

// For troubleshooting, set the log level to DiagLogLevel.DEBUG
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

let sdk: NodeSDK | undefined;
let telemetryInitialized = false;

export function isTelemetrySdkInitialized(): boolean {
  return telemetryInitialized;
}

// TELEMETRY REMOVED: Commented out unused function
// function parseGrpcEndpoint(
//   otlpEndpointSetting: string | undefined,
// ): string | undefined {
//   if (!otlpEndpointSetting) {
//     return undefined;
//   }
//   // Trim leading/trailing quotes that might come from env variables
//   const trimmedEndpoint = otlpEndpointSetting.replace(/^["']|["']$/g, '');

//   try {
//     const url = new URL(trimmedEndpoint);
//     // OTLP gRPC exporters expect an endpoint in the format scheme://host:port
//     // The `origin` property provides this, stripping any path, query, or hash.
//     return url.origin;
//   } catch (error) {
//     diag.error('Invalid OTLP endpoint URL provided:', trimmedEndpoint, error);
//     return undefined;
//   }
// }

export function initializeTelemetry(config: Config): void {
  // TELEMETRY: Modified to ONLY support local file logging - network exporters disabled
  if (telemetryInitialized || !config.getTelemetryEnabled()) {
    return;
  }

  const resource = new Resource({
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

  sdk = new NodeSDK({
    resource,
    spanProcessors: [new BatchSpanProcessor(spanExporter)],
    logRecordProcessor: new BatchLogRecordProcessor(logExporter),
    metricReader,
    instrumentations: [new HttpInstrumentation()],
  });

  try {
    sdk.start();
    telemetryInitialized = true;
    initializeMetrics(config);
  } catch (error) {
    console.error('Error starting OpenTelemetry SDK:', error);
  }

  process.on('SIGTERM', shutdownTelemetry);
  process.on('SIGINT', shutdownTelemetry);
}

export async function shutdownTelemetry(): Promise<void> {
  // TELEMETRY: Shutdown only affects local file writing
  if (!telemetryInitialized || !sdk) {
    return;
  }
  try {
    // ClearcutLogger is disabled - no data sent to Google
    await sdk.shutdown();
  } catch (error) {
    console.error('Error shutting down SDK:', error);
  } finally {
    telemetryInitialized = false;
  }
}
