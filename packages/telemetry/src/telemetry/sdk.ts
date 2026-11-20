/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LogRecord } from '@opentelemetry/api-logs';
import type { RootTelemetry } from './root-telemetry.js';

export type { RequestArtifactLogExporter } from './artifact-exporter.js';

export function isTelemetrySdkInitialized(root: RootTelemetry): boolean {
  return root.isEnabled();
}

export function initializeTelemetry(root: RootTelemetry): Promise<void> {
  return root.setEnabled(true);
}

export function flushTelemetry(root: RootTelemetry): Promise<void> {
  return root.flush();
}

export function shutdownTelemetry(root: RootTelemetry): Promise<void> {
  return root.close();
}

/** Throws unless the root is exporting through a log exporter that supports request artifact schema 4. */
export function assertRequestArtifactExporter(root: RootTelemetry): void {
  root.assertRequestArtifactExporter();
}

/** Artifact completion requires export acknowledgement, unlike legacy best-effort flush. */
export function flushRequestArtifactTelemetry(
  root: RootTelemetry,
  record: LogRecord,
  signal?: AbortSignal,
): Promise<void> {
  return root.publishAcknowledged(record, signal);
}
