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
import type {
  CommandArgumentSchema,
  LiteralArgument,
  TokenInfo,
  ValueArgument,
} from './schema/types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import {
  ephemeralSettingHelp,
  parseEphemeralSettingValue,
} from '../../settings/ephemeralSettings.js';
import {
  filterStrings,
  filterCompletions,
  getFuzzyEnabled,
} from '../utils/fuzzyFilter.js';

// Subcommand for /set unset - removes ephemeral settings or model parameters

/**
 * Implementation for the /set command that handles both:
 * - /set modelparam <key> <value>
 * - /set <ephemeral-key> <value>
 */

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

// Common model parameters - used for deep path completion flattening
const commonParamOptions = [
  { value: 'temperature', description: 'Sampling temperature (0-2)' },
  { value: 'max_tokens', description: 'Maximum tokens to generate' },
  { value: 'top_p', description: 'Nucleus sampling probability' },
  { value: 'top_k', description: 'Top-k sampling' },
  { value: 'frequency_penalty', description: 'Frequency penalty (-2 to 2)' },
  { value: 'presence_penalty', description: 'Presence penalty (-2 to 2)' },
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
    value: 'stream-options',
    hint: 'JSON object (e.g., {"include_usage":false})',
    description:
      'Stream options for OpenAI-compatible APIs (disable include_usage for Mistral)',
    options: [
      {
        value: '{"include_usage":true}',
        description: 'Include usage stats (default)',
      },
      {
        value: '{"include_usage":false}',
        description: 'No usage stats (for Mistral)',
      },
      { value: '{}', description: 'Omit stream_options entirely' },
    ],
  },
  {
    value: 'streaming',
    hint: 'enabled or disabled',
    description: 'boolean value',
    options: booleanOptions,
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
  {
    value: 'prompt-caching',
    hint: 'off, 5m, or 1h',
    description: 'caching mode',
    options: [
      { value: 'off', description: 'disabled' },
      { value: '5m', description: '5 minutes' },
      { value: '1h', description: '1 hour' },
    ],
  },
  {
    value: 'authOnly',
    hint: 'true or false',
    description: 'boolean value',
    options: booleanOptions,
  },
  {
    value: 'include-folder-structure',
    hint: 'true or false',
    description: 'Include folder structure in system prompts',
    options: booleanOptions,
  },
  {
    value: 'dumponerror',
    hint: 'enabled or disabled',
    description: 'dump mode',
    options: streamingOptions,
  },
  {
    value: 'retries',
    hint: 'positive integer (e.g., 3)',
  },
  {
    value: 'retrywait',
    hint: 'positive integer in milliseconds (e.g., 1000)',
  },
  // Reasoning/thinking settings
  {
    value: 'reasoning.enabled',
    hint: 'true or false',
    description: 'Show AI thinking process (Claude, Gemini 3, DeepSeek, etc)',
    options: booleanOptions,
  },
  {
    value: 'reasoning.includeInContext',
    hint: 'true or false',
    description:
      'Send thinking to API on follow-up requests (uses more tokens)',
    options: booleanOptions,
  },
  {
    value: 'reasoning.includeInResponse',
    hint: 'true or false',
    description: 'Display thinking blocks in the UI',
    options: booleanOptions,
  },
  {
    value: 'reasoning.format',
    hint: 'native or field',
    description: 'API format: native=provider default, field=reasoning_content',
    options: [
      { value: 'native', description: 'Use provider default format' },
      {
        value: 'field',
        description: 'Use reasoning_content field (OpenAI style)',
      },
    ],
  },
  {
    value: 'reasoning.stripFromContext',
    hint: 'all, allButLast, or none',
    description: 'Control thinking in history sent to API',
    options: [
      {
        value: 'all',
        description: 'Remove all thinking from history (saves tokens)',
      },
      { value: 'allButLast', description: 'Keep only most recent thinking' },
      { value: 'none', description: 'Keep all thinking in history' },
    ],
  },
  {
    value: 'reasoning.effort',
    hint: 'minimal, low, medium, high, or xhigh',
    description: 'How much the AI should think before responding',
    options: [
      { value: 'minimal', description: 'Quick responses, less deliberation' },
      { value: 'low', description: 'Light thinking for simple tasks' },
      { value: 'medium', description: 'Balanced thinking for most tasks' },
      { value: 'high', description: 'Deep thinking for complex problems' },
      { value: 'xhigh', description: 'Maximum thinking for hardest problems' },
    ],
  },
  {
    value: 'reasoning.maxTokens',
    hint: 'positive integer (e.g., 8000)',
    description: 'Cap on thinking tokens (limits thinking length)',
  },
  // Load balancer settings (Phase 3, Issue #489)
  {
    value: 'tpm_threshold',
    hint: 'positive integer (e.g., 1000)',
  },
  {
    value: 'timeout_ms',
    hint: 'positive integer in milliseconds (e.g., 30000)',
  },
  {
    value: 'circuit_breaker_enabled',
    hint: 'true or false',
    description: 'boolean value',
    options: booleanOptions,
  },
  {
    value: 'circuit_breaker_failure_threshold',
    hint: 'positive integer (e.g., 3)',
  },
  {
    value: 'circuit_breaker_failure_window_ms',
    hint: 'positive integer in milliseconds (e.g., 60000)',
  },
  {
    value: 'circuit_breaker_recovery_timeout_ms',
    hint: 'positive integer in milliseconds (e.g., 30000)',
  },
];

const createSettingLiteral = (spec: SettingLiteralSpec): LiteralArgument => ({
  kind: 'literal' as const,
  value: spec.value,
  description: spec.description ?? `${toTitleCase(spec.value)} option`,
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
        completer: async (ctx, partial) => {
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

          const enableFuzzy = getFuzzyEnabled(ctx);
          const filtered = filterStrings(allKeys, partial, { enableFuzzy });
          return filtered.map((key) => ({
            value: key,
            description: `setting: ${key}`,
          }));
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
              const enableFuzzy = getFuzzyEnabled(ctx);

              if (key === 'modelparam') {
                const params = getRuntimeApi().getActiveModelParams();
                const paramNames = Object.keys(params);
                const filtered = filterStrings(paramNames, partial, {
                  enableFuzzy,
                });
                return filtered.map((name) => ({
                  value: name,
                  description: `Parameter: ${name}`,
                }));
              }

              if (key === 'custom-headers') {
                const headers = getRuntimeApi().getEphemeralSettings()[
                  'custom-headers'
                ] as Record<string, string> | undefined;
                if (headers) {
                  const headerNames = Object.keys(headers);
                  const filtered = filterStrings(headerNames, partial, {
                    enableFuzzy,
                  });
                  return filtered.map((name) => ({
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
        // Static options for deep path completion flattening
        options: commonParamOptions,
        // Dynamic completer also checks active model params at runtime
        completer: async (ctx, partial) => {
          const enableFuzzy = getFuzzyEnabled(ctx);
          // First check for active model params (dynamic)
          const modelParams = getRuntimeApi().getActiveModelParams();
          if (modelParams && Object.keys(modelParams).length > 0) {
            const paramNames = Object.keys(modelParams);
            const matches = filterStrings(paramNames, partial, { enableFuzzy });
            if (matches.length > 0) {
              return matches.map((name) => ({
                value: name,
                description: `Parameter: ${name}`,
              }));
            }
          }

          // Fall back to common params (same as static options)
          return filterCompletions(commonParamOptions, partial, {
            enableFuzzy,
          });
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
          const enableFuzzy = getFuzzyEnabled(ctx);

          if (setting === 'emojifilter') {
            return filterCompletions(emojifilterOptions, partial, {
              enableFuzzy,
            });
          }
          if (setting === 'streaming') {
            return filterCompletions(streamingOptions, partial, {
              enableFuzzy,
            });
          }
          if (
            setting === 'socket-keepalive' ||
            setting === 'socket-nodelay' ||
            setting === 'shell-replacement'
          ) {
            return filterCompletions(booleanOptions, partial, { enableFuzzy });
          }
          if (setting === 'tool-output-truncate-mode') {
            return filterCompletions(truncateModeOptions, partial, {
              enableFuzzy,
            });
          }

          if (setting === 'custom-headers') {
            const headers = getRuntimeApi().getEphemeralSettings()[
              'custom-headers'
            ] as Record<string, string> | undefined;
            if (headers) {
              const headerNames = Object.keys(headers);
              const filtered = filterStrings(headerNames, partial, {
                enableFuzzy,
              });
              return filtered.map((name) => ({
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

    // Use parseEphemeralSettingValue for validation - single source of truth
    // This eliminates duplicate validation and handles type coercion correctly
    const parseResult = parseEphemeralSettingValue(key, value);
    if (!parseResult.success) {
      return {
        type: 'message',
        messageType: 'error',
        content: parseResult.message,
      };
    }
    const parsedValue = parseResult.value;

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
