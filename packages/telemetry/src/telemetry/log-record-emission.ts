/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { LogRecord } from '@opentelemetry/api-logs';
import type { RootTelemetry } from './root-telemetry.js';
import { uiTelemetryService, type UiEvent } from './uiTelemetry.js';
import { debugLogger } from '../utils/debugLogger.js';

/**
 * Capture only synchronous terminal builders; request artifacts publish one
 * chunk at a time. The returned function runs the deferred effects.
 */
export function acknowledgeTerminalTelemetry(
  telemetry: RootTelemetry,
  build: () => void,
  signal?: AbortSignal,
): Promise<() => void> {
  return telemetry.acknowledgeTerminal(build, signal);
}

/**
 * Fail-open wrapper for local aggregation. Errors in the telemetry
 * service must never break the calling stream/tool/api path.
 */
export function aggregateLocally(
  telemetry: RootTelemetry,
  event: UiEvent,
): void {
  telemetry.runAfterTerminalAcknowledgement(() => {
    try {
      uiTelemetryService.addEvent(event);
    } catch (err) {
      try {
        debugLogger.error(
          `[TELEMETRY] Local aggregation failed (fail-open): ${err instanceof Error ? err.message : String(err)}`,
        );
      } catch {
        // Secondary logger failure must not escape the fail-open wrapper
      }
    }
  });
}

/**
 * Emitter for request-artifact publications. Acknowledged emission resolves
 * after the exporter confirms the record; best-effort emission resolves after
 * the root has flushed it, so chunks never accumulate in the SDK queue.
 */
export function recordEmitter(
  telemetry: RootTelemetry,
  signal: AbortSignal | undefined,
  acknowledged: boolean,
): (record: LogRecord) => Promise<void> {
  if (acknowledged)
    return (record) => telemetry.publishAcknowledged(record, signal);
  return (record) => {
    telemetry.events.record(() => record);
    return telemetry.flush();
  };
}
