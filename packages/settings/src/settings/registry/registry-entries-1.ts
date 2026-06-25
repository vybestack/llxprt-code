/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SettingSpec, ValidationResult } from './registry-types.js';

export const REGISTRY_ENTRIES_PART_1: readonly SettingSpec[] = [
  {
    key: 'auth-key',
    aliases: ['apiKey', 'api-key'],
    category: 'provider-config',
    description: 'Provider API authentication key',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'auth-keyfile',
    aliases: ['apiKeyfile', 'api-keyfile'],
    category: 'provider-config',
    description: 'Path to file containing API key',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'auth-key-name',
    category: 'provider-config',
    description:
      'Name of a saved API key in the keyring (resolved via /key save)',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'base-url',
    category: 'provider-config',
    description: 'Provider API base URL',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'sandbox-base-url',
    category: 'provider-config',
    description:
      'Base URL override used when running inside a container sandbox (Docker/Podman)',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'requires-auth',
    category: 'provider-config',
    description:
      'Whether the provider requires API key authentication (set to false for local providers)',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'model',
    category: 'provider-config',
    description: 'Default model name',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'defaultModel',
    category: 'provider-config',
    description: 'Fallback model if primary unavailable',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'enabled',
    category: 'provider-config',
    description: 'Enable/disable provider',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'toolFormat',
    aliases: ['tool-format'],
    category: 'provider-config',
    description: 'Tool format preference',
    type: 'enum',
    enumValues: [
      'auto',
      'openai',
      'anthropic',
      'qwen',
      'kimi',
      'hermes',
      'xml',
      'deepseek',
      'gemma',
      'llama',
    ],
    persistToProfile: true,
  },
  {
    key: 'toolFormatOverride',
    aliases: ['tool-format-override'],
    category: 'provider-config',
    description: 'Force specific tool format',
    type: 'enum',
    enumValues: [
      'auto',
      'openai',
      'anthropic',
      'qwen',
      'kimi',
      'hermes',
      'xml',
      'deepseek',
      'gemma',
      'llama',
    ],
    persistToProfile: true,
  },
  {
    key: 'api-version',
    category: 'cli-behavior',
    description: 'API version to use',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'reasoning.enabled',
    category: 'model-behavior',
    description: 'Enable thinking/reasoning for models that support it',
    type: 'boolean',
    persistToProfile: true,
    completionOptions: [
      { value: 'true', description: 'Enable thinking' },
      { value: 'false', description: 'Disable thinking' },
    ],
  },
  {
    key: 'reasoning.effort',
    category: 'model-behavior',
    description:
      'How much the model should think before responding (minimal/low/medium/high/xhigh)',
    type: 'enum',
    enumValues: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    persistToProfile: true,
  },
  {
    key: 'reasoning.maxTokens',
    category: 'model-behavior',
    description: 'Maximum token budget for reasoning',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'reasoning.budgetTokens',
    category: 'model-behavior',
    description: 'Token budget for reasoning (Anthropic-specific)',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'reasoning.adaptiveThinking',
    category: 'model-behavior',
    description:
      'Enable adaptive thinking for Anthropic Opus 4.6+ (true/false)',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'reasoning.includeInResponse',
    category: 'cli-behavior',
    description: 'Show thinking blocks in UI output',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'reasoning.includeInContext',
    category: 'cli-behavior',
    description: 'Keep thinking in conversation history',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'reasoning.stripFromContext',
    category: 'cli-behavior',
    description: 'Remove thinking blocks from context (all/allButLast/none)',
    type: 'enum',
    enumValues: ['all', 'allButLast', 'none'],
    persistToProfile: true,
  },
  {
    key: 'reasoning.format',
    category: 'cli-behavior',
    description: 'API format for reasoning (native/field)',
    type: 'enum',
    enumValues: ['native', 'field'],
    persistToProfile: true,
  },
  {
    key: 'reasoning.summary',
    category: 'model-behavior',
    description:
      'OpenAI Responses API reasoning summary mode (auto/concise/detailed/none)',
    type: 'enum',
    enumValues: ['auto', 'concise', 'detailed', 'none'],
    persistToProfile: true,
  },
  {
    key: 'text.verbosity',
    category: 'model-behavior',
    description:
      'OpenAI Responses API text verbosity for thinking output (low/medium/high)',
    type: 'enum',
    enumValues: ['low', 'medium', 'high'],
    persistToProfile: true,
  },
  {
    key: 'prompt-caching',
    category: 'model-behavior',
    description: 'Enable prompt caching (off/5m/1h/24h)',
    type: 'enum',
    enumValues: ['off', '5m', '1h', '24h'],
    persistToProfile: true,
  },
  {
    key: 'rate-limit-throttle',
    category: 'model-behavior',
    description: 'Enable proactive rate limit throttling (on/off)',
    type: 'enum',
    enumValues: ['on', 'off'],
    persistToProfile: true,
  },
  {
    key: 'rate-limit-throttle-threshold',
    category: 'model-behavior',
    description: 'Percentage threshold for rate limit throttling (1-100)',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'rate-limit-max-wait',
    category: 'model-behavior',
    description: 'Maximum wait time in milliseconds for rate limit throttling',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'shell-replacement',
    category: 'cli-behavior',
    description: 'Command substitution mode for shell tool',
    type: 'string',
    enumValues: ['allowlist', 'all', 'none', 'true', 'false'],
    persistToProfile: true,
  },
  {
    key: 'streaming',
    category: 'cli-behavior',
    description: 'Enable/disable streaming (enabled/disabled)',
    type: 'enum',
    enumValues: ['enabled', 'disabled'],
    persistToProfile: true,
    completionOptions: [
      { value: 'enabled', description: 'Enable streaming' },
      { value: 'disabled', description: 'Disable streaming' },
    ],
    parse: (raw: string) => {
      if (raw === 'true') return 'enabled';
      if (raw === 'false') return 'disabled';
      return raw;
    },
    validate: (value: unknown): ValidationResult => {
      const validModes = ['enabled', 'disabled'];
      if (typeof value === 'string' && validModes.includes(value)) {
        return { success: true, value };
      }
      return {
        success: false,
        message: `Invalid streaming mode '${String(value)}'. Valid modes are: ${validModes.join(', ')}`,
      };
    },
  },
  {
    key: 'context-limit',
    category: 'cli-behavior',
    description: 'Maximum number of tokens for the context window',
    type: 'number',
    hint: 'positive integer (e.g., 100000)',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message: 'context-limit must be a positive integer (e.g., 100000)',
      };
    },
  },
  {
    key: 'compression-threshold',
    category: 'cli-behavior',
    description:
      'Fraction of context limit that triggers compression (0.0-1.0)',
    type: 'number',
    hint: 'decimal between 0 and 1 (e.g., 0.7)',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && value >= 0 && value <= 1) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'compression-threshold must be a decimal between 0 and 1 (e.g., 0.7 for 70%)',
      };
    },
  },
  {
    key: 'tool-output-max-items',
    category: 'cli-behavior',
    description: 'Maximum number of items/files/matches returned by tools',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message: 'tool-output-max-items must be a positive integer',
      };
    },
  },
  {
    key: 'file-read-max-lines',
    category: 'cli-behavior',
    description:
      'Default maximum lines to read from text files when no explicit limit is provided (default: 2000)',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message: 'file-read-max-lines must be a positive integer',
      };
    },
  },
  {
    key: 'tool-output-max-tokens',
    category: 'cli-behavior',
    description: 'Maximum tokens in tool output',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'tool-output-truncate-mode',
    category: 'cli-behavior',
    description: 'How to handle exceeding limits (warn/truncate/sample)',
    type: 'enum',
    enumValues: ['warn', 'truncate', 'sample'],
    persistToProfile: true,
  },
];
