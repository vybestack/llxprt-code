/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../../config/config.js';
import type { ToolResponseBlock } from '../../services/history/IContent.js';
import { limitOutputTokens } from '../../utils/toolOutputLimiter.js';
import {
  ensureJsonSafe,
  hasUnicodeReplacements,
} from '../../utils/unicodeUtils.js';

export function formatToolResponseText(params: {
  status: 'success' | 'error';
  toolName?: string;
  error?: string;
  output?: string;
}): string {
  const blocks: string[] = [];

  blocks.push('status:');
  blocks.push(params.status);

  blocks.push('');
  blocks.push('toolName:');
  blocks.push(params.toolName ?? '');

  blocks.push('');
  blocks.push('error:');
  blocks.push(params.error ?? '');

  blocks.push('');
  blocks.push('output:');
  blocks.push(params.output ?? '');

  return blocks.join('\n');
}

export interface ToolResponsePayload {
  status: 'success' | 'error';
  toolName?: string;
  result: string;
  error?: string;
  truncated?: boolean;
  originalLength?: number;
  limitMessage?: string;
}

export const EMPTY_TOOL_RESULT_PLACEHOLDER = '[no tool result]';

function coerceToString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return '[unserializable value]';
    }
  }
}

function sanitizeUnicode(result: string): string {
  return hasUnicodeReplacements(result) ? ensureJsonSafe(result) : result;
}

function formatToolResultValue(text: string): {
  value: string;
  originalLength: number;
} {
  return { value: text, originalLength: text.length };
}

function formatToolResult(result: unknown): {
  value?: string;
  originalLength?: number;
  raw?: string;
} {
  if (result === undefined || result === null) {
    return {};
  }
  if (typeof result === 'string') {
    const formatted = formatToolResultValue(result);
    return { ...formatted, raw: result };
  }

  if (typeof result === 'object') {
    const output = (result as { output?: unknown }).output;
    if (typeof output === 'string') {
      const formatted = formatToolResultValue(output);
      return { ...formatted, raw: output };
    }
  }

  const coerced = coerceToString(result);
  return { value: coerced, raw: coerced };
}

function limitToolPayload(
  serializedResult: string,
  block: ToolResponseBlock,
  config?: Config,
): {
  text: string;
  truncated: boolean;
  originalLength?: number;
  limitMessage?: string;
} {
  if (!serializedResult) {
    return {
      text: EMPTY_TOOL_RESULT_PLACEHOLDER,
      truncated: false,
    };
  }

  const originalLength = serializedResult.length;

  if (!config) {
    const sanitized = sanitizeUnicode(serializedResult);
    return {
      text: sanitized,
      truncated: false,
      originalLength,
    };
  }

  const limited = limitOutputTokens(
    serializedResult,
    config,
    block.toolName ?? 'tool_response',
  );
  const candidate =
    limited.content || limited.message || EMPTY_TOOL_RESULT_PLACEHOLDER;
  const sanitized = sanitizeUnicode(candidate);
  return {
    text: sanitized,
    truncated: limited.wasTruncated,
    originalLength,
    limitMessage: limited.wasTruncated ? limited.message : undefined,
  };
}

export function buildToolResponsePayload(
  block: ToolResponseBlock,
  config?: Config,
): ToolResponsePayload {
  const payload: ToolResponsePayload = {
    status: block.error ? 'error' : 'success',
    toolName: block.toolName,
    result: EMPTY_TOOL_RESULT_PLACEHOLDER,
  };

  const formatted = formatToolResult(block.result);
  const serializedResult =
    config && formatted.raw ? formatted.raw : formatted.value;
  if (serializedResult) {
    const limited = limitToolPayload(serializedResult, block, config);
    payload.result = limited.text;
    if (limited.truncated) {
      payload.truncated = true;
      payload.originalLength = limited.originalLength;
    }
    if (limited.limitMessage) {
      payload.limitMessage = limited.limitMessage;
    }
  }

  if (block.error) {
    payload.error = coerceToString(block.error);
  }

  return payload;
}
