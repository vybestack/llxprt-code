/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import {
  appendCheckpointMetadataWarnings,
  foldCheckpointMetadata,
} from './replayCheckpointMetadata.js';
export { foldCheckpointMetadata } from './replayCheckpointMetadata.js';

import {
  type ReplayResult,
  type SessionMetadata,
  type SessionStartPayload,
  type SessionEventPayload,
  type ProviderSwitchPayload,
  type SessionForkedPayload,
  type SemanticMediaPurgePayload,
  type SessionRecordLine,
} from './types.js';

import type { JournalReadCounters } from './journalCounters.js';
const SUPPORTED_RECORDING_VERSIONS = new Set([1, 2]);

export interface ReplayAccumulators {
  metadata: SessionMetadata | null;
  lastSeq: number;
  sequenceCorrupt: boolean;
  eventCount: number;
  warnings: string[];
  sessionEvents: SessionEventPayload[];
  lineNumber: number;
  totalLines: number;
  malformedCount: number;
  _unknownEventCount: number;
  unparseableLineCount: number;

  rawMetadataEvents: SessionRecordLine[];
  semanticMediaPurgeFrontier: SemanticMediaPurgePayload['frontier'] | undefined;

  counters: JournalReadCounters | null;
}
export function createAccumulators(
  counters: JournalReadCounters | null = null,
): ReplayAccumulators {
  return {
    metadata: null,
    lastSeq: 0,
    sequenceCorrupt: false,
    eventCount: 0,
    warnings: [],
    sessionEvents: [],
    lineNumber: 0,
    totalLines: 0,
    malformedCount: 0,
    _unknownEventCount: 0,
    unparseableLineCount: 0,
    rawMetadataEvents: [],
    semanticMediaPurgeFrontier: undefined,
    counters,
  };
}

function trackSequence(
  parsed: Record<string, unknown>,
  lastSeq: number,
  eventCount: number,
  lineNumber: number,
  warnings: string[],
): number {
  const seq = parsed.seq as number | undefined;
  if (seq !== undefined) {
    if (seq <= lastSeq && eventCount > 0) {
      warnings.push(
        `Line ${lineNumber}: non-monotonic seq ${seq} (expected > ${lastSeq})`,
      );
    }
    return Math.max(lastSeq, seq);
  }
  return lastSeq;
}

function resolveWorkspaceDirs(workspaceDirs: unknown): string[] {
  if (workspaceDirs === undefined || workspaceDirs === null) return [];
  if (workspaceDirs === false || workspaceDirs === 0) return [];
  if (workspaceDirs === '' || Number.isNaN(workspaceDirs)) return [];
  return workspaceDirs as string[];
}

function handleSessionStart(
  payload: Record<string, unknown>,
  acc: ReplayAccumulators,
  lineNumber: number,
  expectedProjectHash: string,
): ReplayResult | undefined {
  if (lineNumber !== 1) {
    acc.warnings.push(`session_start at line ${lineNumber} (expected line 1)`);
    return undefined;
  }
  const startPayload = payload as unknown as SessionStartPayload;
  const requiredStrings = [
    startPayload.sessionId,
    startPayload.projectHash,
    startPayload.provider,
    startPayload.model,
    startPayload.startTime,
  ];
  if (
    requiredStrings.some(
      (value) => typeof value !== 'string' || value.length === 0,
    )
  ) {
    return {
      ok: false,
      error: 'Invalid session_start: missing or malformed required fields',
      warnings: acc.warnings,
    };
  }
  if (startPayload.projectHash !== expectedProjectHash) {
    return {
      ok: false,
      error: `Project hash mismatch: expected ${expectedProjectHash} got ${startPayload.projectHash}`,
      warnings: acc.warnings,
    };
  }
  acc.metadata = {
    sessionId: startPayload.sessionId,
    projectHash: startPayload.projectHash,
    provider: startPayload.provider,
    model: startPayload.model,
    workspaceDirs: resolveWorkspaceDirs(startPayload.workspaceDirs),
    ...(typeof startPayload.cwd === 'string' ? { cwd: startPayload.cwd } : {}),
    startTime: startPayload.startTime,
    kind: startPayload.kind === 'subagent' ? 'subagent' : 'main',
    ...(typeof startPayload.parentSessionId === 'string'
      ? { parentSessionId: startPayload.parentSessionId }
      : {}),
  };
  return undefined;
}

function handleProviderSwitch(
  payload: Record<string, unknown>,
  acc: ReplayAccumulators,
  lineNumber: number,
): void {
  const switchPayload = payload as unknown as ProviderSwitchPayload;
  if (acc.metadata && switchPayload.provider) {
    acc.metadata.provider = switchPayload.provider;
    acc.metadata.model = switchPayload.model;
  } else if (!switchPayload.provider) {
    acc.malformedCount++;
    acc.warnings.push(
      `Line ${lineNumber}: malformed provider_switch event, skipping`,
    );
  }
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function handleSessionEvent(
  payload: Record<string, unknown>,
  acc: ReplayAccumulators,
  lineNumber: number,
): void {
  const severity = payload.severity;
  const message = payload.message;
  const VALID_SEVERITIES = new Set(['info', 'warning', 'error']);
  if (
    typeof severity === 'string' &&
    VALID_SEVERITIES.has(severity) &&
    typeof message === 'string'
  ) {
    acc.sessionEvents.push({
      severity: severity as SessionEventPayload['severity'],
      message,
    });
  } else {
    acc.malformedCount++;
    acc.warnings.push(`Line ${lineNumber}: malformed session_event, skipping`);
  }
}

function handleSessionMetadata(
  payload: Record<string, unknown>,
  acc: ReplayAccumulators,
  lineNumber: number,
): void {
  if (acc.metadata === null) {
    acc.malformedCount++;
    acc.warnings.push(
      `Line ${lineNumber}: session_metadata before session_start, skipping`,
    );
    return;
  }
  if (!('title' in payload)) {
    return;
  }
  const title = payload.title;
  if (title === null || typeof title === 'string') {
    acc.metadata.title = title;
  } else if (title !== undefined) {
    acc.malformedCount++;
    acc.warnings.push(
      `Line ${lineNumber}: malformed session_metadata title, skipping`,
    );
  }
}

function handleDirectoriesChanged(
  payload: Record<string, unknown>,
  acc: ReplayAccumulators,
  lineNumber: number,
): void {
  const directories = payload.directories;
  if (acc.metadata && isStringArray(directories)) {
    acc.metadata.workspaceDirs = directories;
  } else if (!isStringArray(directories)) {
    acc.malformedCount++;
    acc.warnings.push(
      `Line ${lineNumber}: malformed directories_changed event, skipping`,
    );
  }
}

function isValidSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function applyParsedEvent(
  parsed: Record<string, unknown> | null,
  acc: ReplayAccumulators,
  expectedProjectHash: string,
): ReplayResult | undefined {
  if (parsed === null) {
    return undefined;
  }
  const recordingVersion = parsed.v;
  if (
    typeof recordingVersion !== 'number' ||
    !SUPPORTED_RECORDING_VERSIONS.has(recordingVersion)
  ) {
    return {
      ok: false,
      error: `Unsupported recording version ${String(recordingVersion)} at line ${acc.lineNumber}`,
      warnings: acc.warnings,
    };
  }
  if (!isValidSequence(parsed.seq)) {
    acc.malformedCount++;
    acc.warnings.push(
      `Line ${acc.lineNumber}: malformed sequence number, skipping`,
    );
    return undefined;
  }
  const eventSequence = parsed.seq;
  if (eventSequence <= acc.lastSeq && acc.eventCount > 0) {
    acc.sequenceCorrupt = true;
  }
  acc.lastSeq = trackSequence(
    parsed,
    acc.lastSeq,
    acc.eventCount,
    acc.lineNumber,
    acc.warnings,
  );
  acc.eventCount++;
  const eventType = parsed.type as string;
  const payloadRaw = parsed.payload;
  if (
    payloadRaw === null ||
    payloadRaw === undefined ||
    typeof payloadRaw !== 'object'
  ) {
    acc.malformedCount++;
    acc.warnings.push(
      `Line ${acc.lineNumber}: malformed ${String(eventType)} event, skipping`,
    );
    return undefined;
  }
  const payload = payloadRaw as Record<string, unknown>;

  return dispatchEvent(
    eventType,
    payload,
    typeof parsed.ts === 'string' ? parsed.ts : '',
    eventSequence,
    acc,
    acc.lineNumber,
    expectedProjectHash,
  );
}

function collectMetadataEvent(
  acc: ReplayAccumulators,
  seq: number,
  timestamp: string,
  type: string,
  payload: Record<string, unknown>,
  lineNumber: number,
): void {
  if (!('checkpointId' in payload) && type !== 'session_named') {
    acc.malformedCount++;
    acc.warnings.push(
      `Line ${lineNumber}: malformed ${type} event (missing checkpointId), skipping`,
    );
    return;
  }
  if (
    (type === 'checkpoint_created' || type === 'checkpoint_renamed') &&
    (typeof payload.name !== 'string' || payload.name.trim() === '')
  ) {
    acc.malformedCount++;
    acc.warnings.push(
      `Line ${lineNumber}: malformed ${type} event (missing name), skipping`,
    );
    return;
  }
  if (type === 'session_forked' && !isSessionForkedPayload(payload)) {
    acc.malformedCount++;
    acc.warnings.push(
      `Line ${lineNumber}: malformed session_forked event, skipping`,
    );
    return;
  }
  acc.rawMetadataEvents.push({
    v: 1,
    seq,
    ts: timestamp,
    type: type as SessionRecordLine['type'],
    payload,
  });
}

function dispatchEvent(
  eventType: string,
  payload: Record<string, unknown>,
  timestamp: string,
  eventSequence: number,
  acc: ReplayAccumulators,
  lineNumber: number,
  expectedProjectHash: string,
): ReplayResult | undefined {
  switch (eventType) {
    case 'content':
    case 'compressed':
    case 'rewind':
    case 'semantic_media_purge':
    case 'density_mutation':
    case 'synthetic_insert':
    case 'chronology_bind':
    case 'compression_detail':
      return undefined;
    case 'session_start':
      return handleSessionStart(payload, acc, lineNumber, expectedProjectHash);
    case 'provider_switch':
      handleProviderSwitch(payload, acc, lineNumber);
      break;
    case 'session_event':
      handleSessionEvent(payload, acc, lineNumber);
      break;
    case 'session_metadata':
      handleSessionMetadata(payload, acc, lineNumber);
      break;
    case 'directories_changed':
      handleDirectoriesChanged(payload, acc, lineNumber);
      break;
    case 'checkpoint_created':
    case 'checkpoint_renamed':
    case 'checkpoint_deleted':
    case 'session_forked':
    case 'session_named':
      collectMetadataEvent(
        acc,
        eventSequence,
        timestamp,
        eventType,
        payload,
        lineNumber,
      );
      break;
    default: {
      acc._unknownEventCount++;
      acc.warnings.push(
        `Line ${lineNumber}: unknown event type '${eventType}', skipping`,
      );
      break;
    }
  }
  return undefined;
}

export function finalizeReplay(acc: ReplayAccumulators): ReplayResult {
  if (acc.metadata === null) {
    if (acc.totalLines === 0) {
      return { ok: false, error: 'Empty file', warnings: acc.warnings };
    }
    return {
      ok: false,
      error: 'Missing or corrupt session_start event',
      warnings: acc.warnings,
    };
  }
  const lastWarning = acc.warnings[acc.warnings.length - 1];
  if (
    lastWarning &&
    lastWarning.startsWith(`Line ${acc.totalLines}:`) &&
    lastWarning.includes('failed to parse')
  ) {
    acc.warnings.pop();
    acc.unparseableLineCount--;
  }
  const totalCorruptCount = acc.malformedCount + acc.unparseableLineCount;
  const denominatorCount = acc.eventCount + acc.unparseableLineCount;
  if (denominatorCount > 0 && totalCorruptCount > 0) {
    const corruptRate = totalCorruptCount / denominatorCount;
    if (corruptRate > 0.05) {
      acc.warnings.push(
        `WARNING: >${(corruptRate * 100).toFixed(1)}% of known events are malformed (${totalCorruptCount}/${denominatorCount})`,
      );
    }
  }
  appendCheckpointMetadataWarnings(acc.rawMetadataEvents, acc.warnings);
  const folded = foldCheckpointMetadata(acc.rawMetadataEvents);
  const sessionName = deriveSessionName(acc.rawMetadataEvents);
  const ancestry = deriveAncestry(acc.rawMetadataEvents);

  return {
    ok: true,
    history: [],
    metadata: acc.metadata,
    lastSeq: acc.lastSeq,
    sequenceCorrupt: acc.sequenceCorrupt,
    eventCount: acc.eventCount,
    warnings: acc.warnings,
    sessionEvents: acc.sessionEvents,
    checkpoints: folded,
    sessionName,
    ancestry,
    ...(acc.semanticMediaPurgeFrontier === undefined
      ? {}
      : { semanticMediaPurgeFrontier: acc.semanticMediaPurgeFrontier }),
  };
}

function isSessionForkedPayload(value: unknown): value is SessionForkedPayload {
  if (typeof value !== 'object' || value === null) return false;
  if (!('parentSessionId' in value) || !('parentSequence' in value)) {
    return false;
  }
  if (!('checkpointId' in value) || !('checkpointName' in value)) return false;
  return (
    typeof value.parentSessionId === 'string' &&
    isValidSequence(value.parentSequence) &&
    typeof value.checkpointId === 'string' &&
    typeof value.checkpointName === 'string'
  );
}

function deriveAncestry(
  events: readonly SessionRecordLine[],
): SessionForkedPayload | undefined {
  for (const line of events) {
    if (
      line.type === 'session_forked' &&
      isSessionForkedPayload(line.payload)
    ) {
      return line.payload;
    }
  }
  return undefined;
}

export function deriveSessionName(
  events: readonly SessionRecordLine[],
): string | null | undefined {
  let result: string | null | undefined = undefined;
  for (const line of events) {
    if (line.type !== 'session_named') continue;
    const payload = line.payload as Record<string, unknown>;
    const name = payload.name;
    if (name === null || typeof name === 'string') {
      result = name;
    }
  }
  return result;
}
