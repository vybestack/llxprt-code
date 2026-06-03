/**
 * Copyright 2025 Vybestack LLC
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
 * @plan PLAN-20260211-SESSIONRECORDING.P08
 * @requirement REQ-RPL-002, REQ-RPL-003, REQ-RPL-005, REQ-RPL-006, REQ-RPL-007, REQ-RPL-008
 *
 * Replay engine implementation. Reads a session JSONL file line-by-line,
 * reconstructing conversation history and metadata. Handles corruption
 * gracefully: corrupt last line is silently discarded (crash recovery),
 * corrupt mid-file lines are skipped with warnings.
 *
 * @pseudocode replay-engine.md lines 10-198
 */

import * as fs from 'node:fs';
import * as readline from 'node:readline';
import {
  type ReplayResult,
  type SessionMetadata,
  type SessionStartPayload,
  type SessionEventPayload,
  type ContentPayload,
  type CompressedPayload,
  type RewindPayload,
  type ProviderSwitchPayload,
  type DirectoriesChangedPayload,
} from './types.js';
import { type IContent } from '../services/history/IContent.js';

// ---------------------------------------------------------------------------
// Private replay accumulators
// ---------------------------------------------------------------------------

/** Mutable state accumulated during session replay. */
interface ReplayAccumulators {
  history: IContent[];
  metadata: SessionMetadata | null;
  lastSeq: number;
  eventCount: number;
  warnings: string[];
  sessionEvents: SessionEventPayload[];
  lineNumber: number;
  totalLines: number;
  malformedCount: number;
  _unknownEventCount: number;
  unparseableLineCount: number;
}

// @pseudocode line 11-17: Initialize accumulators
function createAccumulators(): ReplayAccumulators {
  return {
    history: [],
    metadata: null,
    lastSeq: 0,
    eventCount: 0,
    warnings: [],
    sessionEvents: [],
    lineNumber: 0,
    totalLines: 0,
    malformedCount: 0,
    _unknownEventCount: 0,
    unparseableLineCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Private helpers — line parsing
// ---------------------------------------------------------------------------

/** @pseudocode line 31-39: Parse JSON line, recording warning on failure. */
function parseLine(
  rawLine: string,
  lineNumber: number,
  acc: ReplayAccumulators,
): Record<string, unknown> | null {
  try {
    return JSON.parse(rawLine) as Record<string, unknown>;
  } catch {
    // @pseudocode line 36-38: Record warning (last-line check is deferred to post-processing)
    acc.unparseableLineCount++;
    acc.warnings.push(`Line ${lineNumber}: failed to parse JSON`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Private helpers — sequence tracking
// ---------------------------------------------------------------------------

/** @pseudocode line 44-48: Track sequence numbers, warn on non-monotonic. */
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
    return seq;
  }
  return lastSeq;
}

// ---------------------------------------------------------------------------
// Private helpers — workspaceDirs resolution
// ---------------------------------------------------------------------------

/** Defensive truthiness-style guard: falls back to [] for undefined/null/false/0/empty string/NaN. */
function resolveWorkspaceDirs(workspaceDirs: unknown): string[] {
  if (workspaceDirs === undefined || workspaceDirs === null) return [];
  if (workspaceDirs === false || workspaceDirs === 0) return [];
  if (workspaceDirs === '' || Number.isNaN(workspaceDirs)) return [];
  return workspaceDirs as string[];
}

// ---------------------------------------------------------------------------
// Private helpers — event handlers
// ---------------------------------------------------------------------------

/** @pseudocode line 56-77: session_start — may return early on validation failure. */
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
  if (!startPayload.sessionId || !startPayload.projectHash) {
    return {
      ok: false,
      error: 'Invalid session_start: missing required fields',
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
    startTime: startPayload.startTime,
  };
  return undefined;
}

/** @pseudocode line 79-86: content — push valid content or record malformed. */
function handleContent(
  payload: Record<string, unknown>,
  acc: ReplayAccumulators,
  lineNumber: number,
): void {
  const contentPayload = payload as unknown as ContentPayload;
  const content = contentPayload.content as unknown;
  if (
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    content !== undefined &&
    content !== null &&
    typeof content === 'object' &&
    'speaker' in content &&
    Boolean(content.speaker)
  ) {
    acc.history.push(content as IContent);
  } else {
    acc.malformedCount++;
    acc.warnings.push(`Line ${lineNumber}: malformed content event, skipping`);
  }
}

/** @pseudocode line 88-98: compressed — reset history to [summary] or record malformed. */
function handleCompressed(
  payload: Record<string, unknown>,
  acc: ReplayAccumulators,
  lineNumber: number,
): void {
  const compPayload = payload as unknown as CompressedPayload;
  if (
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Replay fixture session data.
    compPayload.summary?.speaker &&
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, sonarjs/different-types-comparison -- Replay fixture session data.
    compPayload.itemsCompressed !== undefined
  ) {
    acc.history = [compPayload.summary];
  } else {
    acc.malformedCount++;
    acc.warnings.push(
      `Line ${lineNumber}: malformed compressed event, skipping`,
    );
  }
}

/** @pseudocode line 100-112: rewind — validate and apply rewind or record malformed. */
function handleRewind(
  payload: Record<string, unknown>,
  acc: ReplayAccumulators,
  lineNumber: number,
): void {
  const rewindPayload = payload as unknown as RewindPayload;
  const itemsToRemove = rewindPayload.itemsRemoved;
  if (typeof itemsToRemove !== 'number' || itemsToRemove < 0) {
    acc.malformedCount++;
    acc.warnings.push(`Line ${lineNumber}: malformed rewind event, skipping`);
    return;
  }
  if (itemsToRemove >= acc.history.length) {
    acc.history = [];
  } else {
    acc.history = acc.history.slice(0, acc.history.length - itemsToRemove);
  }
}

/** @pseudocode line 114-120: provider_switch — update metadata or record malformed. */
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

/** @pseudocode line 122-126: session_event — collect if valid, otherwise record malformed. */
function handleSessionEvent(
  payload: Record<string, unknown>,
  acc: ReplayAccumulators,
  lineNumber: number,
): void {
  const sePayload = payload as unknown as SessionEventPayload;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Replay fixture session data.
  if (sePayload.severity && typeof sePayload.message === 'string') {
    acc.sessionEvents.push({
      severity: sePayload.severity,
      message: sePayload.message,
    });
  } else {
    acc.malformedCount++;
    acc.warnings.push(`Line ${lineNumber}: malformed session_event, skipping`);
  }
}

/** @pseudocode line 126-131: directories_changed — update metadata or record malformed. */
function handleDirectoriesChanged(
  payload: Record<string, unknown>,
  acc: ReplayAccumulators,
  lineNumber: number,
): void {
  const dirPayload = payload as unknown as DirectoriesChangedPayload;
  if (acc.metadata && Array.isArray(dirPayload.directories)) {
    acc.metadata.workspaceDirs = dirPayload.directories;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Replay fixture session data.
  } else if (!Array.isArray(dirPayload?.directories)) {
    acc.malformedCount++;
    acc.warnings.push(
      `Line ${lineNumber}: malformed directories_changed event, skipping`,
    );
  }
}

// ---------------------------------------------------------------------------
// Private helper — event dispatch
// ---------------------------------------------------------------------------

/** @pseudocode line 54: Dispatch by event type. Returns error result for early-exit cases. */
function dispatchEvent(
  eventType: string,
  payload: Record<string, unknown>,
  acc: ReplayAccumulators,
  lineNumber: number,
  expectedProjectHash: string,
): ReplayResult | undefined {
  switch (eventType) {
    case 'session_start':
      return handleSessionStart(payload, acc, lineNumber, expectedProjectHash);
    case 'content':
      handleContent(payload, acc, lineNumber);
      break;
    case 'compressed':
      handleCompressed(payload, acc, lineNumber);
      break;
    case 'rewind':
      handleRewind(payload, acc, lineNumber);
      break;
    case 'provider_switch':
      handleProviderSwitch(payload, acc, lineNumber);
      break;
    case 'session_event':
      handleSessionEvent(payload, acc, lineNumber);
      break;
    case 'directories_changed':
      handleDirectoriesChanged(payload, acc, lineNumber);
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

// ---------------------------------------------------------------------------
// Private helper — post-processing
// ---------------------------------------------------------------------------

/** @pseudocode line 146-169: Validate metadata, discard corrupt last line, corruption threshold, return. */
function finalizeReplay(acc: ReplayAccumulators): ReplayResult {
  // @pseudocode line 146-151: Validate session_start was present
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

  // @pseudocode line 154-159: Silent discard of corrupt last line
  const lastWarning = acc.warnings[acc.warnings.length - 1];
  if (
    lastWarning &&
    lastWarning.startsWith(`Line ${acc.totalLines}:`) &&
    lastWarning.includes('failed to parse')
  ) {
    acc.warnings.pop();
    acc.unparseableLineCount--;
  }

  // @pseudocode plan Task 8.2: Malformed event 5% threshold warning
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

  // @pseudocode line 161-169: Return success result
  return {
    ok: true,
    history: acc.history,
    metadata: acc.metadata,
    lastSeq: acc.lastSeq,
    eventCount: acc.eventCount,
    warnings: acc.warnings,
    sessionEvents: acc.sessionEvents,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Replay a session from a JSONL file, reconstructing conversation history
 * and metadata.
 *
 * @plan PLAN-20260211-SESSIONRECORDING.P08
 * @requirement REQ-RPL-002, REQ-RPL-003, REQ-RPL-005, REQ-RPL-006, REQ-RPL-007, REQ-RPL-008
 * @pseudocode replay-engine.md lines 10-169
 *
 * @param filePath - Path to the .jsonl session file
 * @param expectedProjectHash - Must match the file's projectHash
 * @returns ReplayResult discriminated union — ok: true with data, or ok: false with error
 */
export async function replaySession(
  filePath: string,
  expectedProjectHash: string,
): Promise<ReplayResult> {
  const acc = createAccumulators();

  // @pseudocode line 20-21: Open file as line-by-line stream
  try {
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const reader = readline.createInterface({ input: stream });

    // @pseudocode line 24: Process each line
    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    for await (let rawLine of reader) {
      // @pseudocode line 25-26
      acc.lineNumber++;
      acc.totalLines = acc.lineNumber;

      // @pseudocode line 28: Skip empty lines
      if (rawLine.trim() === '') continue;

      // @pseudocode line 28b-28e: Strip UTF-8 BOM on first line
      if (acc.lineNumber === 1 && rawLine.startsWith('\uFEFF')) {
        rawLine = rawLine.slice(1);
      }

      // @pseudocode line 31-39: Parse JSON line
      const parsed = parseLine(rawLine, acc.lineNumber, acc);

      // @pseudocode line 41: Skip unparseable lines
      if (parsed === null) continue;

      // @pseudocode line 44-48: Track sequence numbers
      acc.lastSeq = trackSequence(
        parsed,
        acc.lastSeq,
        acc.eventCount,
        acc.lineNumber,
        acc.warnings,
      );

      // @pseudocode line 51
      acc.eventCount++;

      // @pseudocode line 54: Dispatch by event type
      const eventType = parsed.type as string;
      const payload = parsed.payload as Record<string, unknown>;

      const earlyReturn = dispatchEvent(
        eventType,
        payload,
        acc,
        acc.lineNumber,
        expectedProjectHash,
      );
      if (earlyReturn !== undefined) {
        reader.close();
        stream.destroy();
        return earlyReturn;
      }
    }
  } catch (streamError: unknown) {
    // @pseudocode line 141-142
    const message =
      streamError instanceof Error ? streamError.message : String(streamError);
    return {
      ok: false,
      error: `Failed to read file: ${message}`,
      warnings: acc.warnings,
    };
  }

  return finalizeReplay(acc);
}

/**
 * Read only the session header (first line) from a JSONL file.
 * Useful for listing sessions without replaying the entire file.
 *
 * @plan PLAN-20260211-SESSIONRECORDING.P08
 * @requirement REQ-RPL-001
 * @pseudocode replay-engine.md lines 175-198
 *
 * @param filePath - Path to the .jsonl session file
 * @returns The SessionStartPayload from the first line, or null if unreadable
 */
export async function readSessionHeader(
  filePath: string,
): Promise<SessionStartPayload | null> {
  try {
    // @pseudocode line 177-178: Open stream and reader
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const reader = readline.createInterface({ input: stream });
    let firstLine: string | null = null;

    // @pseudocode line 181-184: Read only first line
    for await (const line of reader) {
      firstLine = line;
      break;
    }

    // @pseudocode line 186-187: Clean up
    reader.close();
    stream.destroy();

    // @pseudocode line 189: Check if file was empty
    if (firstLine === null) return null;

    // @pseudocode line 190a-190d: Strip UTF-8 BOM
    if (firstLine.startsWith('\uFEFF')) {
      firstLine = firstLine.slice(1);
    }

    // @pseudocode line 192-194: Parse and validate
    const parsed = JSON.parse(firstLine) as Record<string, unknown>;
    if (parsed.type !== 'session_start') return null;

    return parsed.payload as SessionStartPayload;
  } catch {
    // @pseudocode line 196: Return null on any error
    return null;
  }
}
