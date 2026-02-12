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
 * Shared utility for normalizing tool IDs between provider formats and history format.
 */

const SANITIZE_PATTERN = /[^a-zA-Z0-9_-]/g;

function sanitizeSuffix(suffix: string): string {
  return suffix.replace(SANITIZE_PATTERN, '');
}

/**
 * Normalizes various tool ID formats to OpenAI format (call_xxx).
 * - hist_tool_xxx → call_xxx
 * - toolu_xxx → call_xxx
 * - call_xxx → call_xxx (sanitized)
 * - unknown → call_unknown
 */
export function normalizeToOpenAIToolId(id: string): string {
  if (!id) {
    return 'call_';
  }

  if (id.startsWith('call_')) {
    const suffix = id.substring('call_'.length);
    return `call_${sanitizeSuffix(suffix)}`;
  }

  let suffix = '';
  if (id.startsWith('hist_tool_')) {
    suffix = id.substring('hist_tool_'.length);
  } else if (id.startsWith('toolu_')) {
    suffix = id.substring('toolu_'.length);
  } else {
    suffix = id;
  }

  return `call_${sanitizeSuffix(suffix)}`;
}

/**
 * Normalizes various tool ID formats to history format (hist_tool_xxx).
 * - call_xxx → hist_tool_xxx
 * - toolu_xxx → hist_tool_xxx
 * - hist_tool_xxx → hist_tool_xxx (sanitized)
 */
export function normalizeToHistoryToolId(id: string): string {
  if (!id) {
    return 'hist_tool_';
  }

  if (id.startsWith('hist_tool_')) {
    const suffix = id.substring('hist_tool_'.length);
    return `hist_tool_${sanitizeSuffix(suffix)}`;
  }

  if (id.startsWith('call_')) {
    const suffix = id.substring('call_'.length);
    return `hist_tool_${sanitizeSuffix(suffix)}`;
  }

  if (id.startsWith('toolu_')) {
    const suffix = id.substring('toolu_'.length);
    return `hist_tool_${sanitizeSuffix(suffix)}`;
  }

  return `hist_tool_${sanitizeSuffix(id)}`;
}
