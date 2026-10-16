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
 * @plan:PLAN-20260917-ISSUE854.P05c
 * @requirement:G7
 *
 * Allocation of fs-safe child session ids for subagent journals.
 *
 * The orchestrator's derived ids (`${parent}::${runtime}#${name}#${suffix}`)
 * fail the canonical safe-session lock grammar, and every child of one parent
 * shares the parent's leading characters, so children materialized in the same
 * second collide on a single journal filename. A child id is therefore a fresh
 * random UUID: it satisfies SAFE_SESSION_ID_RE, fills the 12-character journal
 * filename prefix with unique randomness, and is allocated as a pure value so
 * callers can mint it BEFORE any runtime construction.
 */

import { randomUUID } from 'node:crypto';

/**
 * Allocate a random fs-safe child session id.
 *
 * The id matches the canonical safe-session lock grammar
 * (janitor/sessionSafety.ts SAFE_SESSION_ID_RE), is longer than
 * SESSION_FILE_ID_PREFIX_LENGTH so the journal filename prefix is fully
 * random, and is distinct across concurrent allocations.
 */
export function allocateChildSessionId(): string {
  return randomUUID();
}
