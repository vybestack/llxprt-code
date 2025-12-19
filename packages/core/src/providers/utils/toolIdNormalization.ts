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

import crypto from 'node:crypto';

/**
 * Normalize tool IDs from history format to OpenAI format.
 *
 * All tool IDs in IContent are stored in history format (hist_tool_XXX) after being
 * normalized by each provider's normalizeToHistoryToolId() method. This function
 * converts from history format to OpenAI's required call_XXX format.
 *
 * @issue https://github.com/vybestack/llxprt-code/issues/825
 * This function fixes the 400 error "No tool call found for function call output with call_id"
 * that occurs when tool IDs are in hist_tool_XXX format (from cancelled tools or previous turns).
 *
 * IMPORTANT: This function is deterministic - the same input always produces the same output.
 * For edge cases where the ID has no valid characters after sanitization, we generate a
 * deterministic hash-based ID from the original input to ensure function_call and
 * function_call_output items always have matching call_ids.
 */
export function normalizeToOpenAIToolId(id: string): string {
  const generateDeterministicFallbackId = (input: string): string => {
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    return 'call_' + hash.substring(0, 24);
  };

  const sanitize = (value: string): string => {
    const sanitized = value.replace(/[^a-zA-Z0-9_]/g, '');
    if (sanitized.length === 0 || sanitized === 'call_') {
      return generateDeterministicFallbackId(id);
    }
    return sanitized;
  };

  // Already in OpenAI format - just sanitize
  if (id.startsWith('call_')) {
    return sanitize(id);
  }

  // Some systems can produce tool call ids that are malformed:
  // - missing underscore: "call3or3..."
  // - double-prefixed: "call_call3or3..." or "call_call_3or3..."
  // Normalize these to canonical "call_<suffix>".
  if (id.startsWith('call')) {
    let suffix = id.substring('call'.length);
    if (suffix.startsWith('_')) suffix = suffix.substring(1);
    if (suffix.startsWith('call_')) suffix = suffix.substring('call_'.length);
    if (suffix.startsWith('call')) suffix = suffix.substring('call'.length);
    if (suffix.startsWith('_')) suffix = suffix.substring(1);

    return sanitize('call_' + suffix);
  }

  // History format (the canonical storage format) - convert to OpenAI format
  if (id.startsWith('hist_tool_')) {
    const suffix = id.substring('hist_tool_'.length);
    const sanitizedSuffix = suffix.replace(/[^a-zA-Z0-9_]/g, '');
    if (sanitizedSuffix.length === 0) {
      return generateDeterministicFallbackId(id);
    }
    return 'call_' + sanitizedSuffix;
  }

  // Unknown format - prefix with call_ and sanitize
  return sanitize('call_' + id);
}
