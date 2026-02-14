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
  // @pseudocode line 11-17: Initialize accumulators
  let history: IContent[] = [];
  let metadata: SessionMetadata | null = null;
  let lastSeq = 0;
  let eventCount = 0;
  const warnings: string[] = [];
  const sessionEvents: SessionEventPayload[] = [];
  let lineNumber = 0;
  let totalLines = 0;
  let malformedCount = 0;
  let _unknownEventCount = 0;
  let unparseableLineCount = 0;

  // @pseudocode line 20-21: Open file as line-by-line stream
  try {
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const reader = readline.createInterface({ input: stream });

    // @pseudocode line 24: Process each line
    for await (let rawLine of reader) {
      // @pseudocode line 25-26
      lineNumber++;
      totalLines = lineNumber;

      // @pseudocode line 28: Skip empty lines
      if (rawLine.trim() === '') continue;

      // @pseudocode line 28b-28e: Strip UTF-8 BOM on first line
      if (lineNumber === 1 && rawLine.startsWith('\uFEFF')) {
        rawLine = rawLine.slice(1);
      }

      // @pseudocode line 31-39: Parse JSON line
      let parsed: Record<string, unknown> | null;
      try {
        parsed = JSON.parse(rawLine) as Record<string, unknown>;
      } catch {
        // @pseudocode line 36-38: Record warning (last-line check is deferred to post-processing)
        unparseableLineCount++;
        warnings.push(`Line ${lineNumber}: failed to parse JSON`);
        parsed = null;
      }

      // @pseudocode line 41: Skip unparseable lines
      if (parsed === null) continue;

      // @pseudocode line 44-48: Track sequence numbers
      const seq = parsed.seq as number | undefined;
      if (seq !== undefined) {
        if (seq <= lastSeq && eventCount > 0) {
          warnings.push(
            `Line ${lineNumber}: non-monotonic seq ${seq} (expected > ${lastSeq})`,
          );
        }
        lastSeq = seq;
      }

      // @pseudocode line 51
      eventCount++;

      // @pseudocode line 54: Dispatch by event type
      const eventType = parsed.type as string;
      const payload = parsed.payload as Record<string, unknown>;

      switch (eventType) {
        // @pseudocode line 56-77: session_start
        case 'session_start': {
          if (lineNumber !== 1) {
            warnings.push(
              `session_start at line ${lineNumber} (expected line 1)`,
            );
            break;
          }
          const startPayload = payload as unknown as SessionStartPayload;
          if (!startPayload.sessionId || !startPayload.projectHash) {
            reader.close();
            stream.destroy();
            return {
              ok: false,
              error: 'Invalid session_start: missing required fields',
              warnings,
            };
          }
          if (startPayload.projectHash !== expectedProjectHash) {
            reader.close();
            stream.destroy();
            return {
              ok: false,
              error: `Project hash mismatch: expected ${expectedProjectHash} got ${startPayload.projectHash}`,
              warnings,
            };
          }
          metadata = {
            sessionId: startPayload.sessionId,
            projectHash: startPayload.projectHash,
            provider: startPayload.provider,
            model: startPayload.model,
            workspaceDirs: startPayload.workspaceDirs || [],
            startTime: startPayload.startTime,
          };
          break;
        }

        // @pseudocode line 79-86: content
        case 'content': {
          const contentPayload = payload as unknown as ContentPayload;
          if (contentPayload.content && contentPayload.content.speaker) {
            history.push(contentPayload.content);
          } else {
            malformedCount++;
            warnings.push(
              `Line ${lineNumber}: malformed content event, skipping`,
            );
          }
          break;
        }

        // @pseudocode line 88-98: compressed
        case 'compressed': {
          const compPayload = payload as unknown as CompressedPayload;
          if (
            compPayload.summary &&
            compPayload.summary.speaker &&
            compPayload.itemsCompressed !== undefined
          ) {
            history = [compPayload.summary];
          } else {
            malformedCount++;
            warnings.push(
              `Line ${lineNumber}: malformed compressed event, skipping`,
            );
          }
          break;
        }

        // @pseudocode line 100-112: rewind
        case 'rewind': {
          const rewindPayload = payload as unknown as RewindPayload;
          const itemsToRemove = rewindPayload.itemsRemoved;
          if (typeof itemsToRemove !== 'number' || itemsToRemove < 0) {
            malformedCount++;
            warnings.push(
              `Line ${lineNumber}: malformed rewind event, skipping`,
            );
            break;
          }
          if (itemsToRemove >= history.length) {
            history = [];
          } else {
            history = history.slice(0, history.length - itemsToRemove);
          }
          break;
        }

        // @pseudocode line 114-120: provider_switch
        case 'provider_switch': {
          const switchPayload = payload as unknown as ProviderSwitchPayload;
          if (metadata && switchPayload.provider) {
            metadata.provider = switchPayload.provider;
            metadata.model = switchPayload.model;
          } else if (!switchPayload.provider) {
            malformedCount++;
            warnings.push(
              `Line ${lineNumber}: malformed provider_switch event, skipping`,
            );
          }
          break;
        }

        // @pseudocode line 122-126: session_event
        case 'session_event': {
          const sePayload = payload as unknown as SessionEventPayload;
          if (sePayload.severity && typeof sePayload.message === 'string') {
            sessionEvents.push({
              severity: sePayload.severity,
              message: sePayload.message,
            });
          } else {
            malformedCount++;
            warnings.push(
              `Line ${lineNumber}: malformed session_event, skipping`,
            );
          }
          break;
        }

        // @pseudocode line 126-131: directories_changed
        case 'directories_changed': {
          const dirPayload = payload as unknown as DirectoriesChangedPayload;
          if (metadata && Array.isArray(dirPayload.directories)) {
            metadata.workspaceDirs = dirPayload.directories;
          } else if (!Array.isArray(dirPayload?.directories)) {
            malformedCount++;
            warnings.push(
              `Line ${lineNumber}: malformed directories_changed event, skipping`,
            );
          }
          break;
        }

        // @pseudocode line 133-136: Unknown event type
        default: {
          _unknownEventCount++;
          warnings.push(
            `Line ${lineNumber}: unknown event type '${eventType}', skipping`,
          );
          break;
        }
      }
    }
  } catch (streamError: unknown) {
    // @pseudocode line 141-142
    const message =
      streamError instanceof Error ? streamError.message : String(streamError);
    return { ok: false, error: `Failed to read file: ${message}`, warnings };
  }

  // @pseudocode line 146-151: Validate session_start was present
  if (metadata === null) {
    if (totalLines === 0) {
      return { ok: false, error: 'Empty file', warnings };
    }
    return {
      ok: false,
      error: 'Missing or corrupt session_start event',
      warnings,
    };
  }

  // @pseudocode line 154-159: Silent discard of corrupt last line
  const lastWarning = warnings[warnings.length - 1];
  if (
    lastWarning &&
    lastWarning.startsWith(`Line ${totalLines}:`) &&
    lastWarning.includes('failed to parse')
  ) {
    warnings.pop();
    unparseableLineCount--;
  }

  // @pseudocode plan Task 8.2: Malformed event 5% threshold warning
  const totalCorruptCount = malformedCount + unparseableLineCount;
  const denominatorCount = eventCount + unparseableLineCount;
  if (denominatorCount > 0 && totalCorruptCount > 0) {
    const corruptRate = totalCorruptCount / denominatorCount;
    if (corruptRate > 0.05) {
      warnings.push(
        `WARNING: >${(corruptRate * 100).toFixed(1)}% of known events are malformed (${totalCorruptCount}/${denominatorCount})`,
      );
    }
  }

  // @pseudocode line 161-169: Return success result
  return {
    ok: true,
    history,
    metadata,
    lastSeq,
    eventCount,
    warnings,
    sessionEvents,
  };
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
