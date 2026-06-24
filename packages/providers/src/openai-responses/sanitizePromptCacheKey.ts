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

import { createHash } from 'node:crypto';

/**
 * Maximum length for OpenAI prompt_cache_key (API enforces 64 chars).
 */
export const MAX_PROMPT_CACHE_KEY_LENGTH = 64;

/**
 * Short prefix used when a runtimeId exceeds the max length and must be
 * deterministically compressed.  Keeping it compact leaves room for a
 * meaningful hash suffix.
 */
const COMPRESSED_PREFIX = 'rk:';

/**
 * Sanitizes a runtimeId for use as an OpenAI `prompt_cache_key`.
 *
 * - If the trimmed id already fits within the 64-character limit it is
 *   returned unchanged (trimmed).
 * - If the id exceeds the limit it is deterministically mapped to
 *   `rk:` + a SHA-256 hex digest prefix, producing a stable key that
 *   stays within the limit and remains collision-resistant across
 *   distinct runtime IDs.
 *
 * This avoids the "string too long" 400 error (issue #2135) that occurs
 * when compression-profile runtime IDs such as
 * `cli-isolated-...::compression-profile:compression-profile` reach 69+
 * characters.
 */
export function sanitizePromptCacheKey(runtimeId: string): string {
  const trimmed = runtimeId.trim();
  if (trimmed.length <= MAX_PROMPT_CACHE_KEY_LENGTH) {
    return trimmed;
  }

  const hash = createHash('sha256').update(trimmed).digest('hex');
  return `${COMPRESSED_PREFIX}${hash.slice(0, MAX_PROMPT_CACHE_KEY_LENGTH - COMPRESSED_PREFIX.length)}`;
}
