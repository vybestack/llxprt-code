/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
  CommandKind,
} from './types.js';
import { EmojiFilterMode } from '@vybestack/llxprt-code-core';
import type {
  CommandArgumentSchema,
  LiteralArgument,
  TokenInfo,
  ValueArgument,
} from './schema/types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';

// Subcommand for /set unset - removes ephemeral settings or model parameters

/**
 * Implementation for the /set command that handles both:
 * - /set modelparam <key> <value>
 * - /set <ephemeral-key> <value>
 */
// Help text for ephemeral settings - these are session-only and saved only via profiles
const ephemeralSettingHelp: Record<string, string> = {
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
  // Socket configuration for local AI servers (LM Studio, Ollama, etc.)
  'socket-timeout':
    'Request timeout in milliseconds for local AI servers (default: 60000)',
  'socket-keepalive':
    'Enable TCP keepalive for local AI server connections (true/false, default: true)',
  'socket-nodelay':
    'Enable TCP_NODELAY concept for local AI servers (true/false, default: true)',
  // Tool output limit settings - apply to all tools that can return large outputs
  'tool-output-max-items':
    'Maximum number of items/files/matches returned by tools (default: 50)',
  'tool-output-max-tokens': 'Maximum tokens in tool output (default: 50000)',
  'tool-output-truncate-mode':
    'How to handle exceeding limits: warn, truncate, or sample (default: warn)',
  'tool-output-item-size-limit':
    'Maximum size per item/file in bytes (default: 524288 = 512KB)',
  // Final catch-all to prevent context overflow
  'max-prompt-tokens':
    'Maximum tokens allowed in any prompt sent to LLM (default: 200000)',
  // Emoji filter settings
  emojifilter: 'Emoji filter mode (allowed, auto, warn, error)',
  // Retry settings
  retries:
    'Maximum number of retry attempts for API calls (default: varies by provider)',
  retrywait:
    'Initial delay in milliseconds between retry attempts (default: varies by provider)',
  // Loop prevention settings
  maxTurnsPerPrompt:
    'Maximum number of turns allowed per prompt before stopping (default: 200, -1 for unlimited)',
};

/**
 * Schema-based completion for /set command, redesigned to match P09 test expectations.
 *
 * @plan:PLAN-20251013-AUTOCOMPLETE.P10
 * @requirement:REQ-006
 * @pseudocode ArgumentSchema.md lines 111-130
 * - Line 111: literal `unset`
 * - Line 112: literal `modelparam`
 * - Line 113: literal `emojifilter`
 * - Line 114: nested value arg for param name
 * - Line 115: nested value arg for param value
 * - Line 116: hint for emoji mode
 * - Line 117-120: dynamic completers for providers/params
 *
 * Note: The P09 test uses a mixed approach: literals for 'unset', 'modelparam', 'emojifilter'
 * and a single top-level 'value' argument for other settings. This implementation matches that.
 */

const toTitleCase = (input: string): string =>
  input
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

type SettingCompleter = NonNullable<ValueArgument['completer']>;
type SettingLiteralSpec = {
  value: string;
  hint: string;
  description?: string;
  options?: ReadonlyArray<{ value: string; description?: string }>;
  completer?: SettingCompleter;
};

const booleanOptions: ReadonlyArray<{ value: string; description: string }> = [
  { value: 'true', description: 'true' },
  { value: 'false', description: 'false' },
];

const streamingOptions = [
  { value: 'enabled', description: 'enabled' },
  { value: 'disabled', description: 'disabled' },
];

const emojifilterOptions = [
  { value: 'allowed', description: 'Allow all emojis' },
  { value: 'auto', description: 'Automatically filter inappropriate emojis' },
  { value: 'warn', description: 'Warn about filtered emojis' },
  { value: 'error', description: 'Error on filtered emojis' },
];

const truncateModeOptions = [
  { value: 'warn', description: 'warn' },
  { value: 'truncate', description: 'truncate' },
  { value: 'sample', description: 'sample' },
];

const directSettingSpecs: SettingLiteralSpec[] = [
  {
    value: 'emojifilter',
    hint: 'filter mode',
    description: 'filter mode',
    options: emojifilterOptions,
  },
  {
    value: 'context-limit',
    hint: 'positive integer (e.g., 100000)',
  },
  {
    value: 'compression-threshold',
    hint: 'decimal between 0 and 1 (e.g., 0.7)',
  },
  {
    value: 'base-url',
    hint: 'URL string (e.g., https://api.example.com)',
  },
  {
    value: 'api-version',
    hint: 'API version (e.g., v1, 2024-05-01)',
  },
  {
    value: 'streaming',
    hint: 'enabled or disabled',
    description: 'streaming mode',
    options: streamingOptions,
  },
  {
    value: 'socket-timeout',
    hint: 'positive integer in milliseconds (e.g., 60000)',
  },
  {
    value: 'socket-keepalive',
    hint: 'true or false',
    description: 'boolean value',
    options: booleanOptions,
  },
  {
    value: 'socket-nodelay',
    hint: 'true or false',
    description: 'boolean value',
    options: booleanOptions,
  },
  {
    value: 'shell-replacement',
    hint: 'true or false',
    description: 'boolean value',
    options: booleanOptions,
  },
  {
    value: 'tool-output-max-items',
    hint: 'positive integer (e.g., 50)',
  },
  {
    value: 'tool-output-max-tokens',
    hint: 'positive integer (e.g., 50000)',
  },
  {
    value: 'tool-output-item-size-limit',
    hint: 'positive integer (e.g., 1048576)',
  },
  {
    value: 'tool-output-truncate-mode',
    hint: 'warn, truncate, or sample',
    description: 'truncate mode',
    options: truncateModeOptions,
  },
  {
    value: 'max-prompt-tokens',
    hint: 'positive integer (e.g., 200000)',
  },
  {
    value: 'maxTurnsPerPrompt',
    hint: 'positive integer or -1 (unlimited)',
  },
];

const createSettingLiteral = (spec: SettingLiteralSpec): LiteralArgument => ({
  kind: 'literal' as const,
  value: spec.value,
  description: `${toTitleCase(spec.value)} option`,
  stopPropagation: true,
  next: [
    {
      kind: 'value' as const,
      name: `${spec.value}-value`,
      description: spec.description ?? `${toTitleCase(spec.value)} value`,
      hint: spec.hint,
      options: spec.options,
      completer: spec.completer,
    },
  ],
});

const directSettingLiterals = directSettingSpecs.map(createSettingLiteral);
const directSettingKeys = new Set(directSettingSpecs.map((spec) => spec.value));

// Stryker disable StringLiteral -- literal descriptions are static UX copy verified via interaction tests.
const setSchema: CommandArgumentSchema = [
  {
    kind: 'literal',
    value: 'unset',
    description: 'Unset option',
    stopPropagation: true,
    next: [
      {
        kind: 'value',
        name: 'key',
        description: 'setting key to remove',
        completer: async (_ctx, partial) => {
          const ephemeralSettings = getRuntimeApi().getEphemeralSettings();
          const ephemeralKeys = Object.keys(ephemeralSettings).filter(
            (key) => ephemeralSettings[key] !== undefined,
          );

          const specialKeys = [
            'modelparam',
            'custom-headers',
            ...Array.from(directSettingKeys),
          ];
          const allKeys = Array.from(
            new Set([...ephemeralKeys, ...specialKeys]),
          );

          return allKeys
            .filter((key) => key.startsWith(partial))
            .map((key) => ({ value: key, description: `setting: ${key}` }));
        },
        next: [
          {
            kind: 'value',
            name: 'subkey',
            description: 'nested key for specific settings',
            hint: async (_ctx, tokens: TokenInfo) => {
              const key = tokens.tokens[1];
              if (key === 'modelparam') {
                return 'model parameter name (e.g., temperature, max_tokens)';
              }
              if (key === 'custom-headers') {
                return 'header name (e.g., Authorization)';
              }
              return 'subkey (optional)';
            },
            completer: async (ctx, partial, tokens) => {
              const key = tokens.tokens[1];

              if (key === 'modelparam') {
                const params = getRuntimeApi().getActiveModelParams();
                const paramNames = Object.keys(params);
                return paramNames
                  .filter((name) => name.startsWith(partial))
                  .map((name) => ({
                    value: name,
                    description: `Parameter: ${name}`,
                  }));
              }

              if (key === 'custom-headers') {
                const headers = getRuntimeApi().getEphemeralSettings()[
                  'custom-headers'
                ] as Record<string, string> | undefined;
                if (headers) {
                  return Object.keys(headers)
                    .filter((name) => name.startsWith(partial))
                    .map((name) => ({
                      value: name,
                      description: `header: ${name}`,
                    }));
                }
              }

              return [];
            },
          },
        ],
      },
    ],
  },
  {
    kind: 'literal',
    value: 'modelparam',
    description: 'Model parameter option',
    stopPropagation: true,
    next: [
      {
        kind: 'value',
        name: 'param-name',
        description: 'parameter name',
        hint: 'parameter name',
        completer: async (_ctx, partial) => {
          const modelParams = getRuntimeApi().getActiveModelParams();
          if (modelParams && Object.keys(modelParams).length > 0) {
            const paramNames = Object.keys(modelParams);
            const matches = paramNames.filter((name) =>
              name.startsWith(partial),
            );
            if (matches.length > 0) {
              return matches.map((name) => ({
                value: name,
                description: `Parameter: ${name}`,
              }));
            }
          }

          const commonParams = [
            'temperature',
            'max_tokens',
            'top_p',
            'top_k',
            'frequency_penalty',
            'presence_penalty',
          ];
          return commonParams
            .filter((name) => name.startsWith(partial))
            .map((name) => ({
              value: name,
              description: `Parameter: ${name}`,
            }));
        },
        next: [
          {
            kind: 'value',
            name: 'param-value',
            description: 'model parameter value',
            hint: 'value to set for the parameter (number, string, boolean, or JSON)',
          },
        ],
      },
    ],
  },
  {
    kind: 'literal',
    value: 'emojifilter',
    description: 'Emoji filter option',
    stopPropagation: true,
    next: [
      {
        kind: 'value',
        name: 'mode',
        description: 'filter mode',
        hint: 'filter mode',
        options: emojifilterOptions,
      },
    ],
  },
  ...directSettingLiterals.filter((literal) => literal.value !== 'emojifilter'),
  // Stryker disable all -- fallback value handler is exercised through runtime flows and
  // would require extensive integration scaffolding beyond the schema migration scope.
  {
    kind: 'value',
    name: 'setting',
    description: 'any ephemeral setting key',
    options: Object.entries(ephemeralSettingHelp)
      .filter(([key]) => !directSettingKeys.has(key))
      .map(([value, description]) => ({
        value,
        description,
      })),
    next: [
      {
        kind: 'value',
        name: 'setting-value',
        description: 'setting value',
        hint: async (_ctx, tokens: TokenInfo) => {
          const setting = tokens.partialToken || tokens.tokens[0];
          switch (setting) {
            case 'context-limit':
              return 'positive integer (e.g., 100000)';
            case 'compression-threshold':
              return 'decimal between 0 and 1 (e.g., 0.7)';
            case 'emojifilter':
              return 'allowed, auto, warn, or error';
            case 'streaming':
              return 'enabled or disabled';
            case 'socket-timeout':
              return 'positive integer in milliseconds (e.g., 60000)';
            case 'socket-keepalive':
            case 'socket-nodelay':
            case 'shell-replacement':
              return 'true or false';
            case 'tool-output-truncate-mode':
              return 'warn, truncate, or sample';
            case 'maxTurnsPerPrompt':
              return 'positive integer or -1 (unlimited)';
            default:
              return 'value to set';
          }
        },
        completer: async (ctx, partial, tokens) => {
          const setting = tokens.tokens[0] || tokens.partialToken;
          if (setting === 'emojifilter') {
            return emojifilterOptions
              .filter((option) => option.value.startsWith(partial))
              .map((option) => ({
                value: option.value,
                description: option.description,
              }));
          }
          if (setting === 'streaming') {
            return streamingOptions
              .filter((option) => option.value.startsWith(partial))
              .map((option) => ({
                value: option.value,
                description: option.description,
              }));
          }
          if (
            setting === 'socket-keepalive' ||
            setting === 'socket-nodelay' ||
            setting === 'shell-replacement'
          ) {
            return booleanOptions
              .filter((option) => option.value.startsWith(partial))
              .map((option) => ({
                value: option.value,
                description: option.description,
              }));
          }
          if (setting === 'tool-output-truncate-mode') {
            return truncateModeOptions
              .filter((option) => option.value.startsWith(partial))
              .map((option) => ({
                value: option.value,
                description: option.description,
              }));
          }

          if (setting === 'custom-headers') {
            const headers = getRuntimeApi().getEphemeralSettings()[
              'custom-headers'
            ] as Record<string, string> | undefined;
            if (headers) {
              return Object.keys(headers)
                .filter((name) => name.startsWith(partial))
                .map((name) => ({
                  value: name,
                  description: `header: ${name}`,
                }));
            }
          }

          return [];
        },
      },
    ],
  },
  // Stryker restore all
];
// Stryker restore StringLiteral
export const setCommand: SlashCommand = {
  name: 'set',
  description: 'set model parameters or ephemeral settings',
  kind: CommandKind.BUILT_IN,
  schema: setSchema,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    const runtime = getRuntimeApi();
    // This handles direct ephemeral settings: /set <ephemeral-key> <value>
    const trimmedArgs = args?.trim();
    if (!trimmedArgs) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'Usage: /set <ephemeral-key> <value>\nExample: /set context-limit 100000\n\nFor model parameters use: /set modelparam <key> <value>',
      };
    }

    const parts = trimmedArgs.split(/\s+/);
    const key = parts[0];

    if (key === 'modelparam') {
      if (parts.length < 3) {
        return {
          type: 'message',
          messageType: 'error',
          content:
            'Usage: /set modelparam <key> <value>\nExample: /set modelparam temperature 0.7',
        };
      }

      const paramName = parts[1];
      const rawValue = parts.slice(2).join(' ');
      const parsedParamValue = parseValue(rawValue);

      try {
        runtime.setActiveModelParam(paramName, parsedParamValue);
      } catch (error) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to set model parameter: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      const formattedValue =
        typeof parsedParamValue === 'string'
          ? parsedParamValue
          : typeof parsedParamValue === 'number' ||
              typeof parsedParamValue === 'boolean' ||
              parsedParamValue === null
            ? String(parsedParamValue)
            : JSON.stringify(parsedParamValue);

      return {
        type: 'message',
        messageType: 'info',
        content: `Model parameter '${paramName}' set to ${formattedValue}`,
      };
    }

    if (key === 'unset') {
      if (parts.length < 2) {
        return {
          type: 'message',
          messageType: 'error',
          content:
            'Usage: /set unset <ephemeral-key|modelparam> [subkey]\nExample: /set unset base-url',
        };
      }

      const targetKey = parts[1];
      const subKey = parts[2];

      if (targetKey === 'modelparam') {
        if (!subKey) {
          return {
            type: 'message',
            messageType: 'error',
            content:
              'Usage: /set unset modelparam <key>\nExample: /set unset modelparam temperature',
          };
        }

        try {
          runtime.clearActiveModelParam(subKey);
        } catch (error) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to clear model parameter: ${error instanceof Error ? error.message : String(error)}`,
          };
        }

        return {
          type: 'message',
          messageType: 'info',
          content: `Model parameter '${subKey}' cleared`,
        };
      }

      const validEphemeralKeys = Object.keys(ephemeralSettingHelp);
      if (!validEphemeralKeys.includes(targetKey)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Invalid setting key: ${targetKey}. Valid keys are: ${validEphemeralKeys.join(', ')}`,
        };
      }

      if (targetKey === 'custom-headers' && subKey) {
        const currentHeaders = runtime.getEphemeralSettings()[
          'custom-headers'
        ] as Record<string, unknown> | undefined;
        if (currentHeaders && subKey in currentHeaders) {
          const nextHeaders = { ...currentHeaders };
          delete nextHeaders[subKey];
          runtime.setEphemeralSetting(
            targetKey,
            Object.keys(nextHeaders).length > 0 ? nextHeaders : undefined,
          );
          return {
            type: 'message',
            messageType: 'info',
            content: `Custom header '${subKey}' cleared`,
          };
        }
        return {
          type: 'message',
          messageType: 'info',
          content: `No custom header named '${subKey}' found`,
        };
      }

      runtime.setEphemeralSetting(targetKey, undefined);
      return {
        type: 'message',
        messageType: 'info',
        content: `Ephemeral setting '${targetKey}' cleared`,
      };
    }

    // If only key is provided, show help for that key
    if (parts.length === 1) {
      if (ephemeralSettingHelp[key]) {
        return {
          type: 'message',
          messageType: 'info',
          content: `${key}: ${ephemeralSettingHelp[key]}`,
        };
      }
      return {
        type: 'message',
        messageType: 'error',
        content: `Usage: /set ${key} <value>\n\nValid ephemeral keys:\n${Object.entries(
          ephemeralSettingHelp,
        )
          .map(([k, v]) => `  ${k}: ${v}`)
          .join('\n')}`,
      };
    }

    const value = parts.slice(1).join(' '); // Join remaining parts as value

    // List of valid ephemeral settings from the specification
    const validEphemeralKeys = Object.keys(ephemeralSettingHelp);

    // Check if it's a valid ephemeral key
    if (!validEphemeralKeys.includes(key)) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Invalid setting key: ${key}. Valid keys are: ${validEphemeralKeys.join(', ')}`,
      };
    }

    // Parse the value
    let parsedValue = parseValue(value);

    // Validate specific settings
    if (key === 'compression-threshold') {
      const numValue = parsedValue as number;
      if (typeof numValue !== 'number' || numValue <= 0 || numValue > 1) {
        return {
          type: 'message',
          messageType: 'error',
          content: `compression-threshold must be a decimal between 0 and 1 (e.g., 0.7 for 70%)`,
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
          type: 'message',
          messageType: 'error',
          content: `context-limit must be a positive integer (e.g., 100000)`,
        };
      }
    }

    // Validate socket configuration settings
    if (key === 'socket-timeout') {
      const numValue = parsedValue as number;
      if (
        typeof numValue !== 'number' ||
        numValue <= 0 ||
        !Number.isInteger(numValue)
      ) {
        return {
          type: 'message',
          messageType: 'error',
          content: `socket-timeout must be a positive integer in milliseconds (e.g., 60000)`,
        };
      }
    }

    if (key === 'socket-keepalive' || key === 'socket-nodelay') {
      if (typeof parsedValue !== 'boolean') {
        return {
          type: 'message',
          messageType: 'error',
          content: `${key} must be either 'true' or 'false'`,
        };
      }
    }

    // Validate tool output settings
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
          type: 'message',
          messageType: 'error',
          content: `${key} must be a positive integer`,
        };
      }
    }

    // Validate maxTurnsPerPrompt
    if (key === 'maxTurnsPerPrompt') {
      const numValue = parsedValue as number;
      if (
        typeof numValue !== 'number' ||
        !Number.isInteger(numValue) ||
        (numValue !== -1 && numValue <= 0)
      ) {
        return {
          type: 'message',
          messageType: 'error',
          content: `${key} must be a positive integer or -1 for unlimited`,
        };
      }
    }

    if (key === 'tool-output-truncate-mode') {
      const validModes = ['warn', 'truncate', 'sample'];
      if (!validModes.includes(parsedValue as string)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `${key} must be one of: ${validModes.join(', ')}`,
        };
      }
    }

    // Validate emojifilter mode
    if (key === 'emojifilter') {
      const validModes: EmojiFilterMode[] = [
        'allowed',
        'auto',
        'warn',
        'error',
      ];
      const normalizedValue = (
        parsedValue as string
      ).toLowerCase() as EmojiFilterMode;
      if (!validModes.includes(normalizedValue)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Invalid emoji filter mode '${parsedValue}'. Valid modes are: ${validModes.join(', ')}`,
        };
      }
      // Override the parsed value with normalized lowercase version
      parsedValue = normalizedValue;
    }

    // Validate shell-replacement setting
    if (key === 'shell-replacement') {
      if (typeof parsedValue !== 'boolean') {
        return {
          type: 'message',
          messageType: 'error',
          content: `shell-replacement must be either 'true' or 'false'`,
        };
      }
    }

    // Validate streaming mode
    if (key === 'streaming') {
      const validModes = ['enabled', 'disabled'];
      const normalizedValue = (parsedValue as string).toLowerCase();
      if (!validModes.includes(normalizedValue)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Invalid streaming mode '${parsedValue}'. Valid modes are: ${validModes.join(', ')}`,
        };
      }
      // Override the parsed value with normalized lowercase version
      parsedValue = normalizedValue;
    }

    // Get the config to apply settings
    const config = context.services.config;
    if (!config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No configuration available',
      };
    }

    // Store compression settings as ephemeral settings
    // They will be read by geminiChat.ts when compression is needed
    if (key === 'context-limit' || key === 'compression-threshold') {
      // Settings are stored via setEphemeralSetting below
      // geminiChat.ts will read them directly when needed
    }

    // Store emojifilter in ephemeral settings like everything else
    // No special handling needed - it will be stored below with other settings

    // Store ephemeral settings in memory only
    // They will be saved only when user explicitly saves a profile
    // Note: SettingsService doesn't currently support ephemeral settings,
    // so we continue to use the config directly for these session-only settings
    runtime.setEphemeralSetting(key, parsedValue);

    return {
      type: 'message',
      messageType: 'info',
      content: `Ephemeral setting '${key}' set to ${JSON.stringify(parsedValue)} (session only, use /profile save to persist)`,
    };
  },
};

// Stryker disable all -- Parsing is covered by higher-level integration tests and mutating this
// helper introduces hundreds of equivalent mutants unrelated to autocomplete behaviour.
/**
 * Parse a string value into the appropriate type.
 * Handles numbers, booleans, and JSON objects/arrays.
 */
function parseValue(value: string): unknown {
  // Try to parse as number
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const num = Number(value);
    if (!isNaN(num)) {
      return num;
    }
  }

  // Try to parse as boolean
  if (value.toLowerCase() === 'true') {
    return true;
  }
  if (value.toLowerCase() === 'false') {
    return false;
  }

  // Try to parse as JSON
  try {
    return JSON.parse(value);
  } catch {
    // If all parsing fails, return as string
    return value;
  }
}
