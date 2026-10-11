/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DiffStat } from '../internal/interfaces.js';
import type {
  RootTelemetry,
  TelemetryMeasurementOperations,
} from './root-telemetry.js';

export enum FileOperation {
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
}

export function getMeter(root: RootTelemetry): TelemetryMeasurementOperations {
  return root.measurements;
}

export function initializeMetrics(root: RootTelemetry): Promise<void> {
  return root.setEnabled(true);
}

export function resetMetricsState(root: RootTelemetry): Promise<void> {
  return root.setEnabled(false);
}

export function recordToolCallMetrics(
  root: RootTelemetry,
  functionName: string,
  durationMs: number,
  success: boolean,
  decision?: 'accept' | 'reject' | 'modify' | 'auto_accept',
  toolType?: 'native' | 'mcp',
): void {
  root.measurements.toolCall(functionName, durationMs, success, {
    decision,
    tool_type: toolType,
  });
}

export function recordTokenUsageMetrics(
  root: RootTelemetry,
  model: string,
  tokenCount: number,
  type: 'input' | 'output' | 'thought' | 'cache' | 'tool',
): void {
  root.measurements.tokenUsage(model, tokenCount, type);
}

export function recordApiResponseMetrics(
  root: RootTelemetry,
  model: string,
  durationMs: number,
  statusCode?: number | string,
  error?: string,
): void {
  root.measurements.modelResponse(
    model,
    durationMs,
    statusCode ?? (error ? 'error' : 'ok'),
  );
}

export function recordApiErrorMetrics(
  root: RootTelemetry,
  model: string,
  durationMs: number,
  statusCode?: number | string,
  errorType?: string,
): void {
  root.measurements.modelResponse(model, durationMs, statusCode ?? 'error', {
    error_type: errorType ?? 'unknown',
  });
}

export function recordFileOperationMetric(
  root: RootTelemetry,
  operation: FileOperation,
  lines?: number,
  mimetype?: string,
  extension?: string,
  diffStat?: DiffStat,
): void {
  root.measurements.fileOperation({
    operation,
    ...(lines === undefined ? {} : { lines }),
    ...(mimetype === undefined ? {} : { mimetype }),
    ...(extension === undefined ? {} : { extension }),
    ...diffStat,
  });
}

export function recordModelRoutingMetrics(
  root: RootTelemetry,
  event: { model: string; source: string; fallback?: boolean },
): void {
  root.events.record(() => ({
    attributes: { 'event.name': 'llxprt_code.model_routing', ...event },
  }));
}
