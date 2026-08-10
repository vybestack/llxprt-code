/*
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

import type {
  SessionCleanupParams,
  SessionCleanupResult,
} from './janitor/cleanupTypes.js';

export {
  emptyResult,
  type ResolvedRetentionConfig,
  type SessionCleanupParams,
  type SessionCleanupResult,
  type UserRetentionSettings,
} from './janitor/cleanupTypes.js';
export { resolveRetentionConfig } from './janitor/retentionPolicy.js';

/** Load the filesystem-heavy janitor only when a cleanup sweep is requested. */
export async function runSessionCleanup(
  params: SessionCleanupParams,
): Promise<SessionCleanupResult> {
  const janitor = await import('./janitor/sessionJanitor.js');
  return janitor.runSessionCleanup(params);
}
