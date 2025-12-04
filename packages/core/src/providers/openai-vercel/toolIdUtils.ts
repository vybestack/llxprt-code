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
 * @plan PLAN-20251127-OPENAIVERCEL.P04a
 * @requirement REQ-OV-004
 * @description Tool ID normalization utility functions
 */

import * as crypto from 'crypto';

/**
 * Normalizes various tool ID formats to OpenAI format (call_xxx)
 * - hist_tool_xxx → call_xxx
 * - toolu_xxx → call_xxx
 * - call_xxx → call_xxx (unchanged)
 * - raw UUID → call_uuid
 * - Sanitizes non-alphanumeric characters (except underscore)
 * - If result is empty after sanitization, generates a fallback ID
 */
export function normalizeToOpenAIToolId(id: string): string {
  const sanitize = (value: string) =>
    value.replace(/[^a-zA-Z0-9_]/g, '') ||
    'call_' + crypto.randomUUID().replace(/-/g, '');

  // If already in OpenAI format, sanitize and return
  if (id.startsWith('call_')) {
    const sanitized = sanitize(id);
    // If only "call_" remains after sanitization, generate fallback
    if (sanitized === 'call_') {
      return 'call_' + crypto.randomUUID().replace(/-/g, '');
    }
    return sanitized;
  }

  // For history format, extract the UUID and add OpenAI prefix
  if (id.startsWith('hist_tool_')) {
    const uuid = id.substring('hist_tool_'.length);
    const sanitizedUuid = uuid.replace(/[^a-zA-Z0-9_]/g, '');
    // If nothing left after sanitization, generate fallback
    if (!sanitizedUuid) {
      return 'call_' + crypto.randomUUID().replace(/-/g, '');
    }
    return 'call_' + sanitizedUuid;
  }

  // For Anthropic format, extract the UUID and add OpenAI prefix
  if (id.startsWith('toolu_')) {
    const uuid = id.substring('toolu_'.length);
    const sanitizedUuid = uuid.replace(/[^a-zA-Z0-9_]/g, '');
    // If nothing left after sanitization, generate fallback
    if (!sanitizedUuid) {
      return 'call_' + crypto.randomUUID().replace(/-/g, '');
    }
    return 'call_' + sanitizedUuid;
  }

  // Unknown format - assume it's a raw UUID or identifier
  const sanitizedId = id.replace(/[^a-zA-Z0-9_]/g, '');
  // If nothing left after sanitization, generate fallback
  if (!sanitizedId) {
    return 'call_' + crypto.randomUUID().replace(/-/g, '');
  }
  return 'call_' + sanitizedId;
}

/**
 * Normalizes various tool ID formats to history format (hist_tool_xxx)
 * - call_xxx → hist_tool_xxx
 * - toolu_xxx → hist_tool_xxx
 * - hist_tool_xxx → hist_tool_xxx (unchanged)
 * - raw UUID → hist_tool_uuid
 */
export function normalizeToHistoryToolId(id: string): string {
  // If already in history format, sanitize and return
  if (id.startsWith('hist_tool_')) {
    const uuid = id.substring('hist_tool_'.length);
    const sanitizedUuid = uuid.replace(/[^a-zA-Z0-9_]/g, '');
    // If nothing left after sanitization, generate fallback
    if (!sanitizedUuid) {
      return 'hist_tool_' + crypto.randomUUID().replace(/-/g, '');
    }
    return 'hist_tool_' + sanitizedUuid;
  }

  // For OpenAI format, extract the UUID and add history prefix
  if (id.startsWith('call_')) {
    const uuid = id.substring('call_'.length);
    const sanitizedUuid = uuid.replace(/[^a-zA-Z0-9_]/g, '');
    // If nothing left after sanitization, generate fallback
    if (!sanitizedUuid) {
      return 'hist_tool_' + crypto.randomUUID().replace(/-/g, '');
    }
    return 'hist_tool_' + sanitizedUuid;
  }

  // For Anthropic format, extract the UUID and add history prefix
  if (id.startsWith('toolu_')) {
    const uuid = id.substring('toolu_'.length);
    const sanitizedUuid = uuid.replace(/[^a-zA-Z0-9_]/g, '');
    // If nothing left after sanitization, generate fallback
    if (!sanitizedUuid) {
      return 'hist_tool_' + crypto.randomUUID().replace(/-/g, '');
    }
    return 'hist_tool_' + sanitizedUuid;
  }

  // Unknown format - assume it's a raw UUID or identifier
  const sanitizedId = id.replace(/[^a-zA-Z0-9_]/g, '');
  // If nothing left after sanitization, generate fallback
  if (!sanitizedId) {
    return 'hist_tool_' + crypto.randomUUID().replace(/-/g, '');
  }
  return 'hist_tool_' + sanitizedId;
}
