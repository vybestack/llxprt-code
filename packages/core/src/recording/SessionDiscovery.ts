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
 * @plan PLAN-20260211-SESSIONRECORDING.P20
 * @requirement REQ-RSM-003
 * @pseudocode session-management.md lines 10-67
 *
 * Session discovery utility. Scans a chats directory for session files,
 * reads headers to extract metadata, and resolves session references
 * for the resume flow.
 */

import { readBoundedFirstLine } from './boundedHeaderReader.js';
import { type FirstUserMessageScanOptions } from './firstUserMessageScan.js';
import type { JournalReadCounters } from './journalCounters.js';
import { MetadataJsonProjection } from './metadataJsonProjection.js';
import {
  resumeSessionIndexOutOfRangeMessage,
  resumeSessionNotFoundMessage,
} from './resumeNotFoundMessages.js';
import { INVALID_SESSION_START_MESSAGE } from './sessionStartHeader.js';
import {
  SESSION_TITLE_MAX_LENGTH,
  type ContinueResolution,
  type ContinueTarget,
  type SessionStartPayload,
  type SessionSummary,
  type UnreadableRecording,
} from './types.js';

import type { LocalMediaStore } from '../storage/local-media-store.js';
import {
  listJournalSessions,
  readJournalCheckpoints,
  readJournalFileFacts,
  readJournalSessionHeader,
} from './journalSessionListing.js';
import { describeUnreadableRecording } from './unreadableRecordings.js';

/**
 * Result of successfully resolving a session reference.
 */
export interface SessionResolution {
  session: SessionSummary;
}

/**
 * Result when a session reference cannot be resolved.
 */
export interface SessionResolutionError {
  error: string;
}

/**
 * Options for the bounded continue-target discovery pass (issue #854 P05d).
 * The counters are optional; absent means uninstrumented.
 */
export interface BoundedDiscoveryOptions {
  readonly counters?: JournalReadCounters;
}

/**
 * Result shape shared with `listContinueTargetsDetailed` so pickers migrate
 * by swapping the call name.
 */
export interface BoundedContinueTargets {
  targets: ContinueTarget[];
  skippedCount: number;
  recordingErrors: readonly string[];
  unreadableRecordings: readonly UnreadableRecording[];
}

type FirstLineResult =
  | { readonly ok: true; readonly payload: object }
  | { readonly ok: false; readonly reason: string };

/**
 * Read and parse the first line of a recording with the canonical bounded
 * header reader, saying why when it is not a `session_start` event. The
 * payload is returned unvalidated; {@link isSessionStartHeader} is the
 * contract for a usable header.
 *
 * This is the single shared reader used by session discovery, resume, and the
 * session-recording janitor.  It handles UTF-8 BOM and first-line headers of
 * any size up to a documented maximum, classifying no-newline/malformed huge
 * files as unreadable without whole-file buffering.
 */
async function readSessionStartLine(
  filePath: string,
  counters?: JournalReadCounters,
): Promise<FirstLineResult> {
  const firstLine = await readBoundedFirstLine(filePath);
  if (firstLine === null || firstLine.trim() === '') {
    return { ok: false, reason: 'Empty file or unreadable first line' };
  }
  let parsed: unknown;
  try {
    const projection = new MetadataJsonProjection();
    projection.push(firstLine);
    parsed = projection.finish();
  } catch {
    return {
      ok: false,
      reason:
        'Missing or corrupt session_start event: first line is not valid JSON',
    };
  }
  counters?.recordDecoded();
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Reflect.get(parsed, 'type') !== 'session_start'
  ) {
    return {
      ok: false,
      reason:
        'Missing or corrupt session_start event: first line is not a session_start event',
    };
  }
  const payload: unknown = Reflect.get(parsed, 'payload');
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, reason: INVALID_SESSION_START_MESSAGE };
  }
  return { ok: true, payload };
}

/**
 * The first line's `session_start` payload, unvalidated, or null when the
 * first line is not a session_start event. Used by the session-recording
 * janitor, which applies its own retention rules to the fields.
 */
export async function readFirstLineFromFile(
  filePath: string,
  counters?: JournalReadCounters,
): Promise<SessionStartPayload | null> {
  const result = await readSessionStartLine(filePath, counters);
  return result.ok ? (result.payload as SessionStartPayload) : null;
}

interface SessionScan {
  sessions: SessionSummary[];
  unreadableRecordings: UnreadableRecording[];
}

async function journalContinueTargets(
  sessions: readonly SessionSummary[],
  unreadable: UnreadableRecording[],
): Promise<BoundedContinueTargets> {
  const targets: ContinueTarget[] = [];
  const checkpoints: ContinueTarget[] = [];
  for (const session of sessions) {
    const sessionCheckpoints = await readJournalCheckpoints(
      session.filePath,
    ).catch((error: unknown) => {
      unreadable.push({
        sessionId: session.sessionId,
        filePath: session.filePath,
        reason: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    });
    if (sessionCheckpoints === undefined) continue;
    targets.push({ kind: 'session', session });
    for (const checkpoint of sessionCheckpoints) {
      checkpoints.push({
        kind: 'checkpoint',
        source: session,
        checkpointId: checkpoint.checkpointId,
        checkpointName: checkpoint.name,
        sequence: checkpoint.sequence,
      });
    }
  }
  return {
    targets: [...targets, ...checkpoints],
    skippedCount: unreadable.length,
    recordingErrors: unreadable.map(describeUnreadableRecording),
    unreadableRecordings: unreadable,
  };
}

/**
 * Static utility class for discovering and resolving session files.
 *
 * @plan PLAN-20260211-SESSIONRECORDING.P20
 * @requirement REQ-RSM-003
 * @pseudocode session-management.md lines 10-67
 */
export class SessionDiscovery {
  /**
   * List all sessions in a chats directory matching the given project hash,
   * sorted newest-first by file modification time.
   *
   * @pseudocode session-management.md lines 12-44
   */
  static async listSessions(
    chatsDir: string,
    projectHash: string,
  ): Promise<SessionSummary[]> {
    return (await scanSessions(chatsDir, projectHash)).sessions;
  }

  /**
   * Readable continue targets. Recordings that fail the metadata scan are left
   * out; use {@link listContinueTargetsDetailed} to learn which ones and why.
   */
  static async listContinueTargets(
    chatsDir: string,
    projectHash: string,
    mediaStore?: LocalMediaStore,
    options: BoundedDiscoveryOptions = {},
  ): Promise<ContinueTarget[]> {
    const detailed = await this.listContinueTargetsDetailed(
      chatsDir,
      projectHash,
      mediaStore,
      options,
    );
    return detailed.targets;
  }

  static async listContinueTargetsDetailed(
    chatsDir: string,
    projectHash: string,
    _mediaStore?: LocalMediaStore,
    options: BoundedDiscoveryOptions = {},
  ): Promise<BoundedContinueTargets> {
    return SessionDiscovery.listContinueTargetsDetailedBounded(
      chatsDir,
      projectHash,
      options,
    );
  }

  static async listContinueTargetsDetailedBounded(
    chatsDir: string,
    projectHash: string,
    options: BoundedDiscoveryOptions = {},
  ): Promise<BoundedContinueTargets> {
    // Named-class call, not `this`: pickers and the test kit may extract and
    // invoke this static unbound, so it must not depend on the receiver.
    const detailed = await SessionDiscovery.listSessionsDetailed(
      chatsDir,
      projectHash,
      options,
    );
    const unreadable: UnreadableRecording[] = [
      ...detailed.unreadableRecordings,
    ];

    return journalContinueTargets(detailed.sessions, unreadable);
  }

  static resolveContinueRef(
    ref: string,
    targets: readonly ContinueTarget[],
  ): ContinueResolution | SessionResolutionError {
    const checkpointIdMatches = targets.filter(
      (target) => target.kind === 'checkpoint' && target.checkpointId === ref,
    );
    if (checkpointIdMatches.length === 1) {
      return { target: checkpointIdMatches[0] };
    }
    if (checkpointIdMatches.length > 1) {
      return { error: `Ambiguous checkpoint ID '${ref}'` };
    }

    const namedMatches = targets.filter((target) =>
      target.kind === 'session'
        ? target.session.name === ref || target.session.sessionId === ref
        : target.checkpointName === ref,
    );
    if (namedMatches.length === 1) {
      return { target: namedMatches[0] };
    }
    if (namedMatches.length > 1) {
      return { error: `Ambiguous continue target name '${ref}'` };
    }

    const sessions = targets
      .filter(
        (target): target is Extract<ContinueTarget, { kind: 'session' }> =>
          target.kind === 'session',
      )
      .map((target) => target.session);
    if (ref === 'latest' && sessions.length > 0) {
      return { target: { kind: 'session', session: sessions[0] } };
    }
    const resolved = this.resolveSessionRef(ref, sessions);
    return 'session' in resolved
      ? { target: { kind: 'session', session: resolved.session } }
      : resolved;
  }

  static validateName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new Error('Name must not be empty');
    }
    if (trimmed === 'latest' || /^\d+$/.test(trimmed)) {
      throw new Error(`Name '${trimmed}' is reserved`);
    }
    return trimmed;
  }

  static async validateAvailableName(
    name: string,
    chatsDir: string,
    projectHash: string,
  ): Promise<string> {
    const trimmed = this.validateName(name);
    const targets = await this.listContinueTargets(chatsDir, projectHash);
    const conflict = targets.find((target) =>
      target.kind === 'session'
        ? target.session.name === trimmed ||
          target.session.sessionId === trimmed
        : target.checkpointName === trimmed,
    );
    if (conflict) {
      const kind = conflict.kind === 'session' ? 'session' : 'checkpoint';
      throw new Error(
        `Name '${trimmed}' already exists (conflicts with a ${kind})`,
      );
    }
    return trimmed;
  }

  /**
   * Resolve a user-provided session reference (session ID, prefix, or index)
   * against a list of known sessions.
   *
   * Resolution precedence:
   * 1. Exact session ID match
   * 2. If ref is all digits → treat as 1-based numeric index
   * 3. Unique prefix match (ambiguous → error listing matching IDs)
   * 4. Not found → error
   *
   * @pseudocode session-management.md lines 47-67
   */
  static resolveSessionRef(
    ref: string,
    sessions: SessionSummary[],
  ): SessionResolution | SessionResolutionError {
    const exactMatch = sessions.find((s) => s.sessionId === ref);
    if (exactMatch) return { session: exactMatch };

    if (/^\d+$/.test(ref)) {
      const indexNum = parseInt(ref, 10);
      if (indexNum >= 1 && indexNum <= sessions.length) {
        return { session: sessions[indexNum - 1] };
      }
      return {
        error: resumeSessionIndexOutOfRangeMessage(indexNum, sessions.length),
      };
    }

    const prefixMatches = sessions.filter((s) => s.sessionId.startsWith(ref));
    if (prefixMatches.length === 1) return { session: prefixMatches[0] };
    if (prefixMatches.length > 1) {
      const ids = prefixMatches.map((s) => s.sessionId).join(', ');
      return {
        error: `Ambiguous session prefix '${ref}' matches: ${ids}`,
      };
    }

    return { error: resumeSessionNotFoundMessage(ref) };
  }

  /**
   * Read only the session header (first line) from a JSONL file.
   * Delegates to the existing readSessionHeader in ReplayEngine.
   *
   * @pseudocode resume-flow.md header reading
   */
  static async readSessionHeader(
    filePath: string,
  ): Promise<SessionStartPayload | null> {
    return readJournalSessionHeader(filePath);
  }

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P06
   * @requirement REQ-SB-008
   * @pseudocode session-discovery-extensions.md lines 10-60
   *
   * List all sessions in a chats directory matching the given project hash,
   * returning both valid sessions and a count of skipped (corrupted) files.
   * Sessions are sorted newest-first by file modification time.
   */
  static async listSessionsDetailed(
    chatsDir: string,
    projectHash: string,
    options: BoundedDiscoveryOptions = {},
  ): Promise<{
    sessions: SessionSummary[];
    skippedCount: number;
    unreadableRecordings: UnreadableRecording[];
  }> {
    const { sessions, unreadableRecordings } = await scanSessions(
      chatsDir,
      projectHash,
      options,
    );
    return {
      sessions,
      skippedCount: unreadableRecordings.length,
      unreadableRecordings,
    };
  }

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P06
   * @requirement REQ-SB-005
   * @pseudocode session-discovery-extensions.md lines 65-91
   *
   * Check if a session file contains any content events (user or assistant messages).
   * Returns false for non-existent files, empty files, or files with only session_start.
   */
  static async hasContentEvents(
    filePath: string,
    _counters?: JournalReadCounters,
  ): Promise<boolean> {
    const found = await readJournalFileFacts(filePath).catch(() => undefined);
    return (found?.rows ?? 0) > 0;
  }

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P06
   * @requirement REQ-PV-002
   * @pseudocode session-discovery-extensions.md lines 95-165
   *
   * Read the first user message from a session file.
   * Extracts text from TextBlock parts only, ignoring media and tool blocks.
   * Returns null for non-existent files, I/O errors, or no user messages found.
   */
  static async readFirstUserMessage(
    filePath: string,
    maxLength: number = SESSION_TITLE_MAX_LENGTH,
    _options: FirstUserMessageScanOptions = {},
  ): Promise<string | null> {
    const found = await readJournalFileFacts(filePath).catch(() => undefined);
    return found?.preview?.slice(0, maxLength) ?? null;
  }

  /**
   * Read the tri-state title from the last valid `session_metadata` event in a
   * session file (issue #1611). Returns:
   * - `undefined` when no `session_metadata` event exists (legacy fallback).
   * - `null` when the event explicitly asserts untitled.
   * - `string` when the event carries a concrete title.
   */
  static async readSessionMetadataTitle(
    filePath: string,
  ): Promise<string | null | undefined> {
    const found = await readJournalFileFacts(filePath).catch(() => undefined);
    return found?.facts.title;
  }
}

/**
 * Scan the chats directory. Session files whose header is not a valid
 * `session_start` are reported as unreadable (file and reason) instead of
 * being dropped; I/O failures on the directory itself still propagate.
 */
async function scanSessions(
  chatsDir: string,
  projectHash: string,
  _options: BoundedDiscoveryOptions = {},
): Promise<SessionScan> {
  return listJournalSessions(chatsDir, projectHash);
}
