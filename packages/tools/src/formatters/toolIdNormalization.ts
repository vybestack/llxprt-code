/**
 * @plan:PLAN-20260608-ISSUE1585.P05
 * @requirement:REQ-API-001, REQ-TEMPORARY-INTERFACES
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Package-local tool ID normalization utilities.
 *
 * Normalizes tool IDs between provider formats and history format.
 * This is a self-contained copy with core debugLogger replaced
 * by a no-op to maintain zero core imports.
 */

const SANITIZE_PATTERN = /[^a-zA-Z0-9_-]/g;

function sanitizeSuffix(suffix: string): string {
  return suffix.replace(SANITIZE_PATTERN, '');
}

/**
 * Normalizes various tool ID formats to OpenAI format (call_xxx).
 *
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
 *
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

/**
 * Normalizes various tool ID formats to Anthropic format (toolu_xxx).
 *
 * Note: Unlike OpenAI normalization (which removes invalid chars),
 * Anthropic normalization replaces invalid chars with hyphens.
 */
export function normalizeToAnthropicToolId(id: string): string {
  if (!id) {
    return 'toolu_empty';
  }

  if (id.startsWith('toolu_')) {
    return id;
  }

  if (id.startsWith('hist_tool_')) {
    const suffix = id.substring('hist_tool_'.length);
    return `toolu_${suffix.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  }

  if (id.startsWith('call_')) {
    const suffix = id.substring('call_'.length);
    return `toolu_${suffix.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  }

  return `toolu_${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}
