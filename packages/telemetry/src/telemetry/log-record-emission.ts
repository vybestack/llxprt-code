/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { logs, type LogRecord } from '@opentelemetry/api-logs';
import { SERVICE_NAME } from './constants.js';
import {
  assertRequestArtifactExporter,
  flushRequestArtifactTelemetry,
} from './sdk.js';
import { uiTelemetryService, type UiEvent } from './uiTelemetry.js';
import { debugLogger } from '../utils/debugLogger.js';

interface TerminalPublication {
  readonly records: LogRecord[];
  readonly effects: Array<() => void>;
}
let terminalPublication: TerminalPublication | undefined;

/** Capture only synchronous terminal builders; request artifacts publish one chunk at a time. */
export async function acknowledgeTerminalTelemetry(
  build: () => void,
  signal?: AbortSignal,
): Promise<() => void> {
  assertRequestArtifactExporter();
  const publication: TerminalPublication = { records: [], effects: [] };
  const previous = terminalPublication;
  terminalPublication = publication;
  try {
    build();
  } finally {
    terminalPublication = previous;
  }
  for (const record of publication.records)
    await flushRequestArtifactTelemetry(record, signal);
  publication.records.length = 0;
  return (): void => {
    for (const effect of publication.effects.splice(0)) effect();
  };
}

/**
 * Fail-open wrapper for local aggregation. Errors in the telemetry
 * service must never break the calling stream/tool/api path.
 */
export function aggregateLocally(event: UiEvent): void {
  if (terminalPublication !== undefined) {
    terminalPublication.effects.push(() => aggregateLocally(event));
    return;
  }
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
}

/**
 * Fail-open wrapper for SDK export. Errors in the export pipeline must
 * never break the calling stream/tool/api path.
 */
export function emitLogRecord(logRecord: LogRecord): void {
  if (terminalPublication !== undefined) {
    if (terminalPublication.records.length === 2)
      throw new Error('Terminal telemetry exceeds two records');
    terminalPublication.records.push(logRecord);
    return;
  }
  try {
    logs.getLogger(SERVICE_NAME).emit(logRecord);
  } catch (err) {
    try {
      debugLogger.error(
        `[TELEMETRY] SDK export failed (fail-open): ${err instanceof Error ? err.message : String(err)}`,
      );
    } catch {
      // Secondary logger failure must not escape the fail-open wrapper
    }
  }
}

/**
 * Fail-open wrapper for SDK metric recording. Errors in metric instruments
 * must never break the calling stream/tool/api/file/routing path.
 */
export function recordSafely(fn: () => void, context: string): void {
  if (terminalPublication !== undefined) {
    terminalPublication.effects.push(() => recordSafely(fn, context));
    return;
  }
  try {
    fn();
  } catch (err) {
    try {
      debugLogger.error(
        `[TELEMETRY] ${context} failed (fail-open): ${err instanceof Error ? err.message : String(err)}`,
      );
    } catch {
      // Secondary logger failure must not escape the fail-open wrapper
    }
  }
}
