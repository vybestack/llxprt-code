/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EmojiFilterMode } from '@vybestack/llxprt-code-core';

export const ephemeralSettingHelp: Record<string, string> = {
  'context-limit':
    'Maximum number of tokens for the context window (e.g., 100000)',
  'compression-threshold':
    'Fraction of context limit that triggers compression (0.0-1.0, e.g., 0.7 for 70%)',
  'base-url': 'Base URL for API requests',
  'tool-format': 'Tool format override for the provider',
  'api-version': 'API version to use',
  'custom-headers': 'Custom HTTP headers as JSON object',
  'stream-options':
    'Stream options for OpenAI API (default: { include_usage: true })',
  streaming:
    'Enable or disable streaming responses (enabled/disabled, default: enabled)',
  'shell-replacement':
    'Allow command substitution ($(), <(), backticks) in shell commands (default: false)',
  'socket-timeout':
    'Request timeout in milliseconds for local AI servers (default: 60000)',
  'socket-keepalive':
    'Enable TCP keepalive for local AI server connections (true/false, default: true)',
  'socket-nodelay':
    'Enable TCP_NODELAY concept for local AI servers (true/false, default: true)',
  'tool-output-max-items':
    'Maximum number of items/files/matches returned by tools (default: 50)',
  'tool-output-max-tokens': 'Maximum tokens in tool output (default: 50000)',
  'tool-output-truncate-mode':
    'How to handle exceeding limits: warn, truncate, or sample (default: warn)',
  'tool-output-item-size-limit':
    'Maximum size per item/file in bytes (default: 524288 = 512KB)',
  'max-prompt-tokens':
    'Maximum tokens allowed in any prompt sent to LLM (default: 200000)',
  emojifilter: 'Emoji filter mode (allowed, auto, warn, error)',
  retries:
    'Maximum number of retry attempts for API calls (default: varies by provider)',
  retrywait:
    'Initial delay in milliseconds between retry attempts (default: varies by provider)',
  maxTurnsPerPrompt:
    'Maximum number of turns allowed per prompt before stopping (default: 200, -1 for unlimited)',
  authOnly:
    'Force providers to use OAuth authentication only, ignoring API keys and environment variables',
  dumponerror:
    'Dump API request body to ~/.llxprt/dumps/ on errors (enabled/disabled, default: disabled)',
};

const validEphemeralKeys = Object.keys(ephemeralSettingHelp);

export type EphemeralSettingKey = keyof typeof ephemeralSettingHelp;

export interface EphemeralParseSuccess {
  success: true;
  value: unknown;
}

export interface EphemeralParseFailure {
  success: false;
  message: string;
}

export type EphemeralParseResult =
  | EphemeralParseSuccess
  | EphemeralParseFailure;

export function parseEphemeralSettingValue(
  key: string,
  rawValue: string,
): EphemeralParseResult {
  if (!validEphemeralKeys.includes(key)) {
    return {
      success: false,
      message: `Invalid setting key: ${key}. Valid keys are: ${validEphemeralKeys.join(', ')}`,
    };
  }

  let parsedValue = parseValue(rawValue);

  if (key === 'compression-threshold') {
    const numValue = parsedValue as number;
    if (typeof numValue !== 'number' || numValue <= 0 || numValue > 1) {
      return {
        success: false,
        message:
          'compression-threshold must be a decimal between 0 and 1 (e.g., 0.7 for 70%)',
      };
    }
  }

  if (key === 'context-limit') {
    const numValue = parsedValue as number;
    if (
      typeof numValue !== 'number' ||
      numValue <= 0 ||
      !Number.isInteger(numValue)
    ) {
      return {
        success: false,
        message: 'context-limit must be a positive integer (e.g., 100000)',
      };
    }
  }

  if (key === 'socket-timeout') {
    const numValue = parsedValue as number;
    if (
      typeof numValue !== 'number' ||
      numValue <= 0 ||
      !Number.isInteger(numValue)
    ) {
      return {
        success: false,
        message:
          'socket-timeout must be a positive integer in milliseconds (e.g., 60000)',
      };
    }
  }

  if (key === 'socket-keepalive' || key === 'socket-nodelay') {
    if (typeof parsedValue !== 'boolean') {
      return {
        success: false,
        message: `${key} must be either 'true' or 'false'`,
      };
    }
  }

  if (
    key === 'tool-output-max-items' ||
    key === 'tool-output-max-tokens' ||
    key === 'tool-output-item-size-limit' ||
    key === 'max-prompt-tokens'
  ) {
    const numValue = parsedValue as number;
    if (
      typeof numValue !== 'number' ||
      numValue <= 0 ||
      !Number.isInteger(numValue)
    ) {
      return {
        success: false,
        message: `${key} must be a positive integer`,
      };
    }
  }

  if (key === 'maxTurnsPerPrompt') {
    const numValue = parsedValue as number;
    if (
      typeof numValue !== 'number' ||
      !Number.isInteger(numValue) ||
      (numValue !== -1 && numValue <= 0)
    ) {
      return {
        success: false,
        message: `${key} must be a positive integer or -1 for unlimited`,
      };
    }
  }

  if (key === 'tool-output-truncate-mode') {
    const validModes = ['warn', 'truncate', 'sample'];
    if (!validModes.includes(parsedValue as string)) {
      return {
        success: false,
        message: `${key} must be one of: ${validModes.join(', ')}`,
      };
    }
  }

  if (key === 'emojifilter') {
    const validModes: EmojiFilterMode[] = ['allowed', 'auto', 'warn', 'error'];
    const value = parsedValue as string;
    const normalizedValue = value.toLowerCase() as EmojiFilterMode;
    if (!validModes.includes(normalizedValue)) {
      return {
        success: false,
        message: `Invalid emoji filter mode '${parsedValue}'. Valid modes are: ${validModes.join(', ')}`,
      };
    }
    parsedValue = normalizedValue;
  }

  if (key === 'shell-replacement') {
    if (typeof parsedValue !== 'boolean') {
      return {
        success: false,
        message: `shell-replacement must be either 'true' or 'false'`,
      };
    }
  }

  if (key === 'authOnly') {
    if (typeof parsedValue !== 'boolean') {
      return {
        success: false,
        message: `authOnly must be either 'true' or 'false'`,
      };
    }
  }

  if (key === 'streaming' || key === 'dumponerror') {
    const validModes = ['enabled', 'disabled'];
    if (typeof parsedValue === 'boolean') {
      parsedValue = parsedValue ? 'enabled' : 'disabled';
    } else if (
      typeof parsedValue === 'string' &&
      validModes.includes(parsedValue.toLowerCase())
    ) {
      parsedValue = parsedValue.toLowerCase();
    } else if (
      typeof parsedValue === 'string' &&
      validModes.includes(parsedValue.trim().toLowerCase())
    ) {
      parsedValue = parsedValue.trim().toLowerCase();
    } else if (
      typeof parsedValue === 'string' &&
      ['true', 'false'].includes(parsedValue.toLowerCase())
    ) {
      parsedValue =
        parsedValue.toLowerCase() === 'true' ? 'enabled' : 'disabled';
    } else {
      return {
        success: false,
        message: `Invalid ${key} mode '${parsedValue}'. Valid modes are: ${validModes.join(', ')}`,
      };
    }
  }

  return { success: true, value: parsedValue };
}

function parseValue(value: string): unknown {
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const num = Number(value);
    if (!Number.isNaN(num)) {
      return num;
    }
  }

  if (value.toLowerCase() === 'true') {
    return true;
  }
  if (value.toLowerCase() === 'false') {
    return false;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
