/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { LogRecord, LogAttributes } from '@opentelemetry/api-logs';
import type { TelemetryConfig } from '../internal/interfaces.js';
import { isTelemetrySdkInitialized } from './sdk.js';
import {
  artifactAttributes,
  emitRequestArtifact,
  type RequestArtifactDescriptor,
} from './request-artifact.js';

type Emit = (record: LogRecord) => void | Promise<void>;

export function logTelemetryEvent(
  config: TelemetryConfig,
  event: object,
  emit: Emit,
): void;
export function logTelemetryEvent(
  config: TelemetryConfig,
  event: object,
  emit: Emit,
  artifact: RequestArtifactDescriptor | undefined,
  signal?: AbortSignal,
  acknowledged?: boolean,
): void | Promise<void>;
export function logTelemetryEvent(
  config: TelemetryConfig,
  event: object,
  emit: Emit,
  artifact?: RequestArtifactDescriptor,
  signal?: AbortSignal,
  acknowledged = false,
): void | Promise<void> {
  if (!isTelemetrySdkInitialized()) return;
  const attributes: LogAttributes = { 'session.id': config.getSessionId() };
  for (const [key, value] of Object.entries(event)) {
    if (key === 'request_artifact') continue;
    if (typeof value === 'object' && value !== null)
      attributes[key] = JSON.stringify(value);
    else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    )
      attributes[key] = value;
  }
  if (artifact !== undefined)
    Object.assign(attributes, artifactAttributes(artifact));
  const base = emit({
    body: `Telemetry event: ${attributes['event.name']}`,
    attributes,
  });
  if (artifact !== undefined)
    return Promise.resolve(base).then(() =>
      emitRequestArtifact(artifact, attributes, emit, signal, acknowledged),
    );
  return base;
}
