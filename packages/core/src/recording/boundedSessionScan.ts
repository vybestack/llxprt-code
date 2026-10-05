/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan PLAN-20260917-ISSUE854.P05d
 * @requirement G3, G5
 *
 * Bounded metadata scan over a session journal (issue #854, resume without
 * materialization). Streams the file line by line and decodes only the
 * envelopes that carry continue-target facts — `session_start`,
 * `session_named`, and the `checkpoint_*` lifecycle — folding them with the
 * same rules as the eager replay engine so both views of one journal agree.
 * Content values are syntax-checked and discarded by the streaming JSON
 * projection before any object or string payload is materialized.
 *
 * Memory is bounded by `O(metadata lines)` per session, independent of
 * content length. Failure parity with `replaySession` is exact for the
 * outcomes discovery acts on: unsupported recording versions, malformed
 * `session_start`, and project-hash mismatches fail the scan; unparseable
 * lines (mid-file or crash-torn tail) are tolerated; non-monotonic
 * sequences surface as `sequenceCorrupt`.
 */

import { readMetadataJsonLines } from './metadataJsonLines.js';
import { deriveSessionName, foldCheckpointMetadata } from './ReplayEngine.js';
import type { JournalReadCounters } from './journalCounters.js';
import type {
  CheckpointMetadataView,
  SessionRecordLine,
  SessionStartPayload,
} from './types.js';

/** Recording versions this scan accepts, mirroring the replay engine. */
const SUPPORTED_RECORDING_VERSIONS = new Set([1, 2]);

function isValidSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Scan state carried across the line stream, mirroring replay accumulators. */
interface BoundedScanState {
  expectedProjectHash: string;
  counters: JournalReadCounters | null;
  lineNumber: number;
  sessionStartSeen: boolean;
  lastSeq: number;
  eventCount: number;
  sequenceCorrupt: boolean;
  /** Collected `session_named` / `checkpoint_*` lines for folding. */
  metadataEvents: SessionRecordLine[];
}

/**
 * Result of one session's metadata scan: the facts continue-target discovery
 * needs, or the engine-parity error that makes the session unlistable.
 */
export type BoundedScanResult =
  | {
      ok: true;
      sequenceCorrupt: boolean;
      sessionName: string | null | undefined;
      checkpoints: CheckpointMetadataView[];
    }
  | { ok: false; error: string };

function createBoundedScanState(
  expectedProjectHash: string,
  counters: JournalReadCounters | null,
): BoundedScanState {
  return {
    expectedProjectHash,
    counters,
    lineNumber: 0,
    sessionStartSeen: false,
    lastSeq: 0,
    eventCount: 0,
    sequenceCorrupt: false,
    metadataEvents: [],
  };
}

/**
 * Scan one session journal's metadata envelopes without decoding any content
 * row. Errors and sequence handling mirror `replaySession` exactly; see the
 * module header for the tolerated corruption cases.
 */
export async function scanSessionMetadata(
  filePath: string,
  expectedProjectHash: string,
  counters: JournalReadCounters | null,
): Promise<BoundedScanResult> {
  const state = createBoundedScanState(expectedProjectHash, counters);
  try {
    for await (const line of readMetadataJsonLines(filePath)) {
      state.lineNumber = line.lineNumber;
      const failure = absorbBoundedLine(line.parsed, state);
      if (failure !== null) return { ok: false, error: failure };
    }
  } catch (streamError: unknown) {
    const message =
      streamError instanceof Error ? streamError.message : String(streamError);
    return { ok: false, error: `Failed to read file: ${message}` };
  }
  return finalizeBoundedScan(state);
}

/**
 * Fold one journal line into the scan state. Returns the engine-parity error
 * string when the line fails the replay engine's hard-failure gates, or null
 * when the line is tolerated (empty, unparseable, malformed, or folded).
 */
function absorbBoundedLine(
  parsed: unknown,
  state: BoundedScanState,
): string | null {
  if (parsed === null) return null;
  state.counters?.recordDecoded();
  if (typeof parsed !== 'object') {
    // The engine reads `.v` off whatever JSON.parse returned, so a scalar
    // or array envelope fails the version gate as `undefined`.
    return `Unsupported recording version undefined at line ${state.lineNumber}`;
  }
  const record = parsed as Record<string, unknown>;
  const version = record.v;
  if (
    typeof version !== 'number' ||
    !SUPPORTED_RECORDING_VERSIONS.has(version)
  ) {
    return `Unsupported recording version ${String(version)} at line ${state.lineNumber}`;
  }
  const seq = record.seq;
  if (!isValidSequence(seq)) return null;
  if (seq <= state.lastSeq && state.eventCount > 0) {
    state.sequenceCorrupt = true;
  }
  state.lastSeq = Math.max(state.lastSeq, seq);
  state.eventCount += 1;
  const payload = record.payload;
  if (payload === null || typeof payload !== 'object') return null;
  return dispatchBoundedEvent(
    record,
    seq,
    payload as Record<string, unknown>,
    state,
  );
}

/**
 * Dispatch one well-formed envelope. Only `session_start` can fail the scan;
 * only name/checkpoint envelopes are folded. Everything else — content rows,
 * history mutations, metadata events — is engine-bookkeeping discovery never
 * reads, so the decoded payload is dropped here.
 */
function dispatchBoundedEvent(
  record: Record<string, unknown>,
  seq: number,
  payload: Record<string, unknown>,
  state: BoundedScanState,
): string | null {
  const eventType = record.type as string;
  if (eventType === 'session_start') {
    return absorbBoundedSessionStart(payload, state);
  }
  if (
    eventType === 'checkpoint_created' ||
    eventType === 'checkpoint_renamed' ||
    eventType === 'checkpoint_deleted' ||
    eventType === 'session_named'
  ) {
    collectBoundedMetadataEvent(state, seq, record, eventType, payload);
  }
  return null;
}

/** Engine parity with handleSessionStart: line 1, required fields, hash. */
function absorbBoundedSessionStart(
  payload: Record<string, unknown>,
  state: BoundedScanState,
): string | null {
  if (state.lineNumber !== 1) return null;
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
    return 'Invalid session_start: missing or malformed required fields';
  }
  if (startPayload.projectHash !== state.expectedProjectHash) {
    return `Project hash mismatch: expected ${state.expectedProjectHash} got ${startPayload.projectHash}`;
  }
  state.sessionStartSeen = true;
  return null;
}

/**
 * Collect a name/checkpoint event for folding, mirroring the engine's
 * collectMetadataEvent guards so both paths fold identical event sets:
 * checkpoint events require a checkpointId, created/renamed require a
 * non-blank name, and `session_named` is always collected.
 */
function collectBoundedMetadataEvent(
  state: BoundedScanState,
  seq: number,
  record: Record<string, unknown>,
  type: SessionRecordLine['type'],
  payload: Record<string, unknown>,
): void {
  if (!('checkpointId' in payload) && type !== 'session_named') return;
  if (
    (type === 'checkpoint_created' || type === 'checkpoint_renamed') &&
    (typeof payload.name !== 'string' || payload.name.trim() === '')
  ) {
    return;
  }
  state.metadataEvents.push({
    v: 1,
    seq,
    ts: typeof record.ts === 'string' ? record.ts : '',
    type,
    payload,
  });
}

/** Engine parity with finalizeReplay's session_start validation. */
function finalizeBoundedScan(state: BoundedScanState): BoundedScanResult {
  if (!state.sessionStartSeen) {
    if (state.lineNumber === 0) {
      return { ok: false, error: 'Empty file' };
    }
    return { ok: false, error: 'Missing or corrupt session_start event' };
  }
  return {
    ok: true,
    sequenceCorrupt: state.sequenceCorrupt,
    sessionName: deriveSessionName(state.metadataEvents),
    checkpoints: foldCheckpointMetadata(state.metadataEvents),
  };
}
