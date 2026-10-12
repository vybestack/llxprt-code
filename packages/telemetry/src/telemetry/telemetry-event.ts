/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { LogRecord, LogAttributes } from '@opentelemetry/api-logs';
import type { TelemetryConfig } from '../internal/interfaces.js';
import type { RootTelemetry } from './root-telemetry.js';
import { recordEmitter } from './log-record-emission.js';
import { safeJsonStringify } from '../utils/safeJsonStringify.js';
import {
  artifactAttributes,
  emitRequestArtifact,
  type RequestArtifactDescriptor,
} from './request-artifact.js';

export interface TelemetryEventDelivery {
  readonly artifact?: RequestArtifactDescriptor;
  readonly signal?: AbortSignal;
  /** Resolve only after the exporter acknowledges every record. */
  readonly acknowledged?: boolean;
}

function eventAttributes(
  config: Pick<TelemetryConfig, 'getSessionId'>,
  event: object,
): LogAttributes {
  const attributes: LogAttributes = { 'session.id': config.getSessionId() };
  for (const [key, value] of Object.entries(event)) {
    if (key === 'request_artifact') continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    )
      attributes[key] = value;
    else if (value !== undefined) attributes[key] = safeJsonStringify(value);
  }
  return attributes;
}

/** Logs a conversation or provider event; artifact or acknowledged delivery returns a promise. */
export function logTelemetryEvent(
  config: Pick<TelemetryConfig, 'getSessionId'>,
  event: object,
  telemetry: RootTelemetry,
  delivery: TelemetryEventDelivery = {},
): void | Promise<void> {
  if (!telemetry.isEnabled()) return;
  const { artifact, signal, acknowledged = false } = delivery;
  if (!acknowledged && artifact === undefined) {
    telemetry.events.record(() => ({
      body: `Telemetry event: ${eventName(event)}`,
      attributes: eventAttributes(config, event),
    }));
    return;
  }
  const attributes = eventAttributes(config, event);
  if (artifact !== undefined)
    Object.assign(attributes, artifactAttributes(artifact));
  const emit = recordEmitter(telemetry, signal, acknowledged);
  const record: LogRecord = {
    body: `Telemetry event: ${String(attributes['event.name'])}`,
    attributes,
  };
  const base = emit(record);
  if (artifact === undefined) return base;
  return base.then(() =>
    emitRequestArtifact(artifact, attributes, emit, signal),
  );
}

function eventName(event: object): string {
  return String((event as Record<string, unknown>)['event.name']);
}
