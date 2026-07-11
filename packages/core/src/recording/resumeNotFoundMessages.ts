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
 * The "session not found"-style messages the resume/discovery flow emits, as
 * shared constants so downstream classifiers (e.g. the Zed ACP loadSession
 * error mapper) can match them WITHOUT string-literal coupling that would
 * silently break if the wording changed. The emitting sites
 * (resumeSession.ts, SessionDiscovery.ts) and every matcher must reference
 * these — never inline copies of the sentences.
 */

/** Emitted by resumeSession when the project has no recorded sessions at all. */
export const RESUME_NO_SESSIONS_FOUND = 'No sessions found for this project';

/**
 * Prefix of the SessionDiscovery.resolveSessionRef message for an unknown
 * session reference; the full message appends `: <ref>`.
 */
export const RESUME_SESSION_NOT_FOUND_PREFIX =
  'Session not found for this project:';

/**
 * Builds the full SessionDiscovery.resolveSessionRef not-found message for a
 * specific reference.
 */
export function resumeSessionNotFoundMessage(ref: string): string {
  return `${RESUME_SESSION_NOT_FOUND_PREFIX} ${ref}`;
}

/**
 * Prefix of the SessionDiscovery.resolveSessionRef message for a numeric
 * session index outside the listing range; the full message is
 * `Session index <n> out of range (1-<m>)`.
 */
export const RESUME_SESSION_INDEX_OUT_OF_RANGE_PREFIX = 'Session index ';

/**
 * Builds the full SessionDiscovery.resolveSessionRef out-of-range message for
 * a specific index and session count.
 */
export function resumeSessionIndexOutOfRangeMessage(
  ref: string | number,
  count: number,
): string {
  return `${RESUME_SESSION_INDEX_OUT_OF_RANGE_PREFIX}${ref} out of range (1-${count})`;
}

/**
 * Matches the out-of-range message shape for classifiers that only have the
 * final (envelope-wrapped) detail string to inspect.
 */
export const RESUME_SESSION_INDEX_OUT_OF_RANGE_RE =
  /Session index \d+ out of range/;
