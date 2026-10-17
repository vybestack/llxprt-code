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
 * Canonical header reader adapter for the session-recording janitor (AC-1).
 *
 * Delegates to the single canonical bounded JSONL header reader
 * ({@link readFirstLineFromFile} in {@link SessionDiscovery}, which in turn
 * falls back to {@link readSessionHeader} in {@link ReplayEngine}) rather than
 * maintaining a second drifting copy of the buffer/readline/BOM logic. This
 * guarantees the janitor discovers recordings using the exact same header
 * handling as session discovery and resume, including UTF-8 BOM stripping and
 * first-line headers larger than the initial 4 KiB buffer.
 *
 * The adapter maps the canonical {@link SessionStartPayload} to the janitor's
 * narrower {@link SessionHeaderInfo} view and applies the janitor's stricter
 * "sessionId must be present" rule, so unreadable recordings are reported as
 * `null` for retention protection (AC-7).
 */

import { readFirstLineFromFile } from '../SessionDiscovery.js';
import { readJournalFileFacts } from '../journalSessionListing.js';
import { SESSION_FILE_EXTENSION } from '../sessionFileExtension.js';
import { isValidSafeSessionId } from './sessionSafety.js';

/** Payload fields the janitor extracts from the session_start header. */
export interface SessionHeaderInfo {
  readonly sessionId: string;
  readonly startTime: string;
  readonly projectHash?: string;
}

/**
 * Read the `session_start` header from a JSONL recording using the canonical
 * bounded header reader shared with session discovery/resume.  Returns `null`
 * for empty files, non-JSON lines, lines that are not `session_start` events,
 * or events whose `sessionId` cannot be established safely.
 *
 * Session IDs are validated against the canonical safe grammar (Item 2): any
 * unsafe/path-like identifier makes the recording unreadable/protected so it
 * cannot be used to redirect archive/temp writes or escape the chats directory
 * via lock path construction.
 */
export async function readSessionJsonlHeader(
  filePath: string,
): Promise<SessionHeaderInfo | null> {
  const payload = await readFirstLineFromFile(filePath);
  if (payload === null) return null;
  if (typeof payload.sessionId !== 'string' || payload.sessionId === '') {
    return null;
  }
  // Validate the session ID against the canonical safe grammar so a
  // path-like identifier (e.g. "../../etc/passwd") cannot be used to
  // construct a lock path or archive name that escapes the managed root.
  if (!isValidSafeSessionId(payload.sessionId)) {
    return null;
  }
  const startTime =
    typeof payload.startTime === 'string' && payload.startTime !== ''
      ? payload.startTime
      : new Date().toISOString();
  const projectHash =
    typeof payload.projectHash === 'string' ? payload.projectHash : undefined;
  return { sessionId: payload.sessionId, startTime, projectHash };
}

/**
 * Read the session facts of a journal recording through the read-only journal
 * view (no row is read). Returns `null` for a file that holds no committed
 * session or cannot be opened as a journal, and for an unsafe session id: the
 * file is external input, and an unreadable recording stays protected (AC-7).
 */
async function readJournalHeader(
  filePath: string,
): Promise<SessionHeaderInfo | null> {
  let found;
  try {
    found = await readJournalFileFacts(filePath);
  } catch {
    return null;
  }
  if (found === undefined) return null;
  const { sessionId, start } = found.facts;
  if (!isValidSafeSessionId(sessionId)) return null;
  return {
    sessionId,
    startTime: start.startTime,
    projectHash: start.projectHash,
  };
}

/**
 * Read the header of a raw session recording of either format, chosen by the
 * file extension: `.llxj` through the journal reader, anything else through
 * the JSONL header reader.
 */
export async function readSessionHeaderInfo(
  filePath: string,
): Promise<SessionHeaderInfo | null> {
  return filePath.endsWith(SESSION_FILE_EXTENSION)
    ? readJournalHeader(filePath)
    : readSessionJsonlHeader(filePath);
}
