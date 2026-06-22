/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CommandArgumentSchema,
  LiteralArgument,
  TokenInfo,
  ValueArgument,
} from './schema/types.js';
import type { CommandContext } from './types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { ephemeralSettingHelp } from '@vybestack/llxprt-code-providers/runtime/ephemeralSettings.js';
import {
  getDirectSettingSpecs,
  resolveAlias,
} from '@vybestack/llxprt-code-settings';
import {
  filterStrings,
  filterCompletions,
  getFuzzyEnabled,
} from '../utils/fuzzyFilter.js';

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

// Common model parameters - used for deep path completion flattening in modelparam context
const commonParamOptions = [
  { value: 'temperature', description: 'Sampling temperature (0-2)' },
  { value: 'max_tokens', description: 'Maximum tokens to generate' },
  { value: 'top_p', description: 'Nucleus sampling probability' },
  { value: 'top_k', description: 'Top-k sampling' },
  { value: 'frequency_penalty', description: 'Frequency penalty (-2 to 2)' },
  { value: 'presence_penalty', description: 'Presence penalty (-2 to 2)' },
];

const buildDirectSettingSpecs = (): SettingLiteralSpec[] => {
  const registrySpecs = getDirectSettingSpecs();
  return registrySpecs.map(
    (spec: {
      value: string;
      hint: string;
      description?: string;
      options?: ReadonlyArray<{ value: string; description?: string }>;
    }) => ({
      value: spec.value,
      hint: spec.hint,
      description: spec.description,
      options: spec.options,
    }),
  );
};

const directSettingSpecs: SettingLiteralSpec[] = buildDirectSettingSpecs();
const directSettingSpecByValue = new Map(
  directSettingSpecs.map((spec) => [spec.value, spec]),
);

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

function buildModelParamSchemaNext(): CommandArgumentSchema {
  return [
    {
      kind: 'value',
      name: 'param-name',
      description: 'parameter name',
      hint: 'parameter name',
      options: commonParamOptions,
      completer: async (ctx, partial) => {
        const enableFuzzy = getFuzzyEnabled(ctx);
        const modelParams = getRuntimeApi().getActiveModelParams();
        const paramNames = Object.keys(modelParams);
        if (paramNames.length > 0) {
          const matches = filterStrings(paramNames, partial, { enableFuzzy });
          if (matches.length > 0) {
            return matches.map((name) => ({
              value: name,
              description: `Parameter: ${name}`,
            }));
          }
        }

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
  ];
}

function buildSettingValueHint(
  _ctx: CommandContext,
  tokens: TokenInfo,
): Promise<string> {
  const setting = tokens.partialToken || tokens.tokens[0];
  let result: string;
  switch (setting) {
    case 'context-limit':
      result = 'positive integer (e.g., 100000)';
      break;
    case 'compression-threshold':
      result = 'decimal between 0 and 1 (e.g., 0.7)';
      break;
    case 'emojifilter':
      result = 'allowed, auto, warn, or error';
      break;
    case 'streaming':
      result = 'enabled or disabled';
      break;
    case 'socket-timeout':
      result = 'positive integer in milliseconds (e.g., 60000)';
      break;
    case 'socket-keepalive':
    case 'socket-nodelay':
      result = 'true or false';
      break;
    case 'shell-replacement':
      result = 'allowlist, all, or none';
      break;
    case 'tool-output-truncate-mode':
      result = 'warn, truncate, or sample';
      break;
    case 'maxTurnsPerPrompt':
      result = 'positive integer or -1 (unlimited)';
      break;
    default:
      result = 'value to set';
      break;
  }
  return Promise.resolve(result);
}

function buildSettingValueCompleter(): NonNullable<ValueArgument['completer']> {
  return async (ctx, partial, tokens) => {
    const setting = tokens.tokens[0] || tokens.partialToken;
    const enableFuzzy = getFuzzyEnabled(ctx);

    const resolvedSetting = resolveAlias(setting);
    const registryOptions =
      directSettingSpecByValue.get(resolvedSetting)?.options;

    if (registryOptions && registryOptions.length > 0) {
      return filterCompletions(registryOptions, partial, { enableFuzzy });
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
  };
}

export { directSettingKeys, directSettingSpecByValue };

function buildUnsetSubkeyCompleter(): NonNullable<ValueArgument['completer']> {
  return async (ctx, partial, tokens) => {
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
  };
}

function buildUnsetKeyCompleter(): NonNullable<ValueArgument['completer']> {
  return async (ctx, partial) => {
    const ephemeralSettings = getRuntimeApi().getEphemeralSettings();
    const ephemeralKeys = Object.keys(ephemeralSettings).filter(
      (key) => ephemeralSettings[key] !== undefined,
    );

    const specialKeys = [
      'modelparam',
      'custom-headers',
      ...Array.from(directSettingKeys),
    ];
    const allKeys = Array.from(new Set([...ephemeralKeys, ...specialKeys]));

    const enableFuzzy = getFuzzyEnabled(ctx);
    const filtered = filterStrings(allKeys, partial, { enableFuzzy });
    return filtered.map((key) => ({
      value: key,
      description: `setting: ${key}`,
    }));
  };
}

function buildUnsetLiteral(): CommandArgumentSchema[number] {
  return {
    kind: 'literal',
    value: 'unset',
    description: 'Unset option',
    stopPropagation: true,
    next: [
      {
        kind: 'value',
        name: 'key',
        description: 'setting key to remove',
        completer: buildUnsetKeyCompleter(),
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
            completer: buildUnsetSubkeyCompleter(),
          },
        ],
      },
    ],
  };
}

function buildSettingFallback(): CommandArgumentSchema[number] {
  return {
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
        hint: buildSettingValueHint,
        completer: buildSettingValueCompleter(),
      },
    ],
  };
}

/**
 * Constructs the /set command argument schema. Extracted from setCommand.ts
 * so the large schema definition and its completers are independently
 * maintainable and the command file stays under complexity limits.
 */
export function buildSetSchema(): CommandArgumentSchema {
  return [
    buildUnsetLiteral(),
    {
      kind: 'literal',
      value: 'modelparam',
      description: 'Model parameter option',
      stopPropagation: true,
      next: buildModelParamSchemaNext(),
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
          options: directSettingSpecByValue.get('emojifilter')?.options ?? [],
        },
      ],
    },
    ...directSettingLiterals.filter(
      (literal) => literal.value !== 'emojifilter',
    ),
    buildSettingFallback(),
  ];
}
