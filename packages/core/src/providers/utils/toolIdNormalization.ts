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
 * Normalize tool IDs from various formats to OpenAI format
 * Handles IDs from OpenAI (call_xxx), Anthropic (toolu_xxx), and history (hist_tool_xxx)
 *
 * @issue https://github.com/vybestack/llxprt-code/issues/825
 * This function fixes the 400 error "No tool call found for function call output with call_id"
 * that occurs when tool IDs are in non-OpenAI formats (like hist_tool_XXX from cancelled tools).
 */
export function normalizeToOpenAIToolId(id: string): string {
  const generateFallbackId = (): string =>
    'call_' + crypto.randomUUID().replace(/-/g, '');

  const sanitize = (value: string): string => {
    const sanitized = value.replace(/[^a-zA-Z0-9_]/g, '');
    if (sanitized.length === 0 || sanitized === 'call_') {
      return generateFallbackId();
    }
    return sanitized;
  };

  const normalizeWithPrefix = (prefix: string): string => {
    const suffix = id.substring(prefix.length);
    const sanitizedSuffix = suffix.replace(/[^a-zA-Z0-9_]/g, '');
    if (sanitizedSuffix.length === 0) {
      return generateFallbackId();
    }
    return 'call_' + sanitizedSuffix;
  };

  if (id.startsWith('call_')) {
    return sanitize(id);
  }

  if (id.startsWith('hist_tool_')) {
    return normalizeWithPrefix('hist_tool_');
  }

  if (id.startsWith('toolu_')) {
    return normalizeWithPrefix('toolu_');
  }

  return sanitize('call_' + id);
}
