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

export function humanizeJsonForDisplay(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const obj = value as Record<string, unknown>;

  // Prefer common text fields to avoid JSON-stringifying multi-line output.
  for (const key of [
    'error',
    'error_text',
    'message',
    'llmContent',
    'returnDisplay',
  ]) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) {
      return v;
    }
  }

  // Common shell-like result shape.
  const stdout = obj.stdout;
  const stderr = obj.stderr;
  const exitCode = obj.exitCode;
  const hasStdout = typeof stdout === 'string' && stdout.trim();
  const hasStderr = typeof stderr === 'string' && stderr.trim();
  const hasExitCode = typeof exitCode === 'number';

  if (hasStdout || hasStderr || hasExitCode) {
    const out: string[] = [];

    if (hasExitCode) {
      out.push('exitCode:');
      out.push(String(exitCode));
      out.push('');
    }

    if (hasStdout) {
      out.push('stdout:');
      out.push(
        String(stdout)
          .replace(/[\r\n]+$/, '')
          .trimEnd(),
      );
      out.push('');
    }

    if (hasStderr) {
      out.push('stderr:');
      out.push(
        String(stderr)
          .replace(/[\r\n]+$/, '')
          .trimEnd(),
      );
      out.push('');
    }

    return out.join('\n').trimEnd();
  }

  return undefined;
}

function coerceToString(value: unknown, humanizeJson?: boolean): string {
  if (typeof value === 'string') {
    return value;
  }

  // Default behavior is JSON.stringify for non-strings. For OpenAI tool output we may prefer
  // a human-readable multi-line rendering to preserve newlines.
  if (humanizeJson) {
    const human = humanizeJsonForDisplay(value);
    if (typeof human === 'string' && human.trim()) {
      return human;
    }
    // Fallback: pretty JSON (multi-line) instead of a single-line blob.
    if (value && typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        // no-op
      }
    }
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

function formatToolResult(
  result: unknown,
  humanizeJson?: boolean,
): {
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

  const coerced = coerceToString(result, humanizeJson);
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
  humanizeJson?: boolean,
): ToolResponsePayload {
  const payload: ToolResponsePayload = {
    status: block.error ? 'error' : 'success',
    toolName: block.toolName,
    result: EMPTY_TOOL_RESULT_PLACEHOLDER,
  };

  const formatted = formatToolResult(block.result, humanizeJson);
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
    payload.error = coerceToString(block.error, humanizeJson);
  }

  return payload;
}
