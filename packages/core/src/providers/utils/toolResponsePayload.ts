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

const MAX_TOOL_RESPONSE_CHARS = 1024;
const MAX_TOOL_RESPONSE_TEXT_CHARS = 512;

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

function sanitizeResultString(result: string): {
  text: string;
  truncated: boolean;
  originalLength: number;
} {
  const sanitized = hasUnicodeReplacements(result)
    ? ensureJsonSafe(result)
    : result;

  if (sanitized.length <= MAX_TOOL_RESPONSE_CHARS) {
    return {
      text: sanitized,
      truncated: false,
      originalLength: sanitized.length,
    };
  }

  const truncatedText = `${sanitized.slice(
    0,
    MAX_TOOL_RESPONSE_CHARS,
  )}… [truncated ${sanitized.length - MAX_TOOL_RESPONSE_CHARS} chars]`;

  return {
    text: truncatedText,
    truncated: true,
    originalLength: sanitized.length,
  };
}

function limitToolResponseText(text: string): {
  value: string;
  truncated: boolean;
  originalLength: number;
} {
  let limited = text;
  let truncated = false;
  const originalLength = text.length;

  const lines = limited.split('\n');
  if (lines.length > 1) {
    limited = `${lines[0]}\n[+${lines.length - 1} more lines omitted]`;
    truncated = true;
  }

  if (limited.length > MAX_TOOL_RESPONSE_TEXT_CHARS) {
    limited = `${limited.slice(0, MAX_TOOL_RESPONSE_TEXT_CHARS)}… [truncated ${limited.length - MAX_TOOL_RESPONSE_TEXT_CHARS} chars]`;
    truncated = true;
  }

  return { value: limited, truncated, originalLength };
}

function formatToolResult(result: unknown): {
  value?: string;
  truncated?: boolean;
  originalLength?: number;
  raw?: string;
} {
  if (result === undefined || result === null) {
    return {};
  }
  if (typeof result === 'string') {
    const limited = limitToolResponseText(result);
    return { ...limited, raw: result };
  }
  try {
    const serialized = JSON.stringify(result);
    return { value: serialized, raw: serialized };
  } catch {
    const coerced = coerceToString(result);
    return { value: coerced, raw: coerced };
  }
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

  if (!config) {
    const normalized = sanitizeResultString(serializedResult);
    return {
      text: normalized.text,
      truncated: normalized.truncated,
      originalLength: normalized.originalLength,
    };
  }

  const limited = limitOutputTokens(
    serializedResult,
    config,
    block.toolName ?? 'tool_response',
  );
  const candidate =
    limited.content || limited.message || EMPTY_TOOL_RESULT_PLACEHOLDER;
  const normalized = sanitizeResultString(candidate);
  return {
    text: normalized.text,
    truncated: limited.wasTruncated || normalized.truncated,
    originalLength: normalized.originalLength,
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
  if (formatted.truncated) {
    payload.truncated = true;
    payload.originalLength = formatted.originalLength ?? payload.originalLength;
  }

  if (block.error) {
    payload.error = coerceToString(block.error);
  }

  return payload;
}
