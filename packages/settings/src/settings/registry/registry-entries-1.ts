/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SettingSpec, ValidationResult } from './registry-types.js';

const REASONING_EFFORT_KEYS = new Set([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

const REASONING_ENABLED_KEYS = new Set(['true', 'false']);

/** Numeric effort-map values are explicit budgets with a hard floor. */
const MIN_MAPPED_BUDGET_TOKENS = 1024;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Plain JSON objects only: arrays and class/Map/Set instances (whose
 * entries do not serialize as JSON keys) fail validation instead of being
 * silently accepted as reasoning maps.
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function isReasoningEffortMapValue(value: unknown): boolean {
  if (value === null || isNonEmptyString(value)) {
    return true;
  }
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_MAPPED_BUDGET_TOKENS
  );
}

function isReasoningEnabledMapValue(value: unknown): boolean {
  return (
    value === null || typeof value === 'boolean' || isNonEmptyString(value)
  );
}

function validateReasoningEffortMap(value: unknown): ValidationResult {
  if (!isJsonObject(value)) {
    return {
      success: false,
      message: 'reasoning.effortMap must be a JSON object',
    };
  }

  for (const [key, mappedValue] of Object.entries(value)) {
    if (!REASONING_EFFORT_KEYS.has(key)) {
      return {
        success: false,
        message: `reasoning.effortMap contains unsupported key '${key}'`,
      };
    }
    if (!isReasoningEffortMapValue(mappedValue)) {
      return {
        success: false,
        message: `reasoning.effortMap values must be non-empty strings, integer budgets of at least ${MIN_MAPPED_BUDGET_TOKENS}, or null`,
      };
    }
  }

  return { success: true, value };
}

function validateReasoningEnabledMap(value: unknown): ValidationResult {
  if (!isJsonObject(value)) {
    return {
      success: false,
      message: 'reasoning.enabledMap must be a JSON object',
    };
  }

  for (const [key, mappedValue] of Object.entries(value)) {
    if (!REASONING_ENABLED_KEYS.has(key)) {
      return {
        success: false,
        message: `reasoning.enabledMap contains unsupported key '${key}'`,
      };
    }
    if (!isReasoningEnabledMapValue(mappedValue)) {
      return {
        success: false,
        message:
          'reasoning.enabledMap values must be non-empty strings, booleans, or null',
      };
    }
  }

  return { success: true, value };
}

export const REGISTRY_ENTRIES_PART_1: readonly SettingSpec[] = [
  {
    key: 'auth-key',
    aliases: ['apiKey', 'api-key'],
    category: 'provider-config',
    owner: 'provider-connection',
    propagation: 'service-reconfigure',
    description: 'Provider API authentication key',
    type: 'string',
    persistToProfile: true,
    sensitive: true,
  },
  {
    key: 'auth-keyfile',
    aliases: ['apiKeyfile', 'api-keyfile'],
    category: 'provider-config',
    owner: 'provider-connection',
    propagation: 'service-reconfigure',
    description: 'Path to file containing API key',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'auth-key-name',
    category: 'provider-config',
    owner: 'provider-connection',
    propagation: 'service-reconfigure',
    description:
      'Name of a saved API key in the keyring (resolved via /key save)',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'base-url',
    category: 'provider-config',
    owner: 'provider-connection',
    propagation: 'service-reconfigure',
    description: 'Provider API base URL',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'sandbox-base-url',
    category: 'provider-config',
    owner: 'provider-connection',
    propagation: 'service-reconfigure',
    description:
      'Base URL override used when running inside a container sandbox (Docker/Podman)',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'requires-auth',
    category: 'provider-config',
    owner: 'provider-connection',
    propagation: 'service-reconfigure',
    description:
      'Whether the provider requires API key authentication (set to false for local providers)',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'model',
    category: 'provider-config',
    owner: 'provider-connection',
    propagation: 'service-reconfigure',
    description: 'Default model name',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'defaultModel',
    category: 'provider-config',
    owner: 'provider-connection',
    propagation: 'service-reconfigure',
    description: 'Fallback model if primary unavailable',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'enabled',
    category: 'provider-config',
    owner: 'provider-connection',
    propagation: 'service-reconfigure',
    description: 'Enable/disable provider',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'toolFormat',
    aliases: ['tool-format'],
    category: 'provider-config',
    owner: 'provider-connection',
    propagation: 'service-reconfigure',
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
    owner: 'provider-connection',
    propagation: 'service-reconfigure',
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
    owner: 'provider-connection',
    propagation: 'next-turn',
    description: 'API version to use',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'apiMode',
    category: 'provider-config',
    owner: 'provider-connection',
    propagation: 'service-reconfigure',
    description:
      'Preferred OpenAI transport mode (responses/chat); chat is ignored for models that require the Responses API',
    type: 'enum',
    enumValues: ['responses', 'chat'],
    persistToProfile: true,
  },
  {
    key: 'responsesMode',
    category: 'provider-config',
    owner: 'provider-connection',
    propagation: 'service-reconfigure',
    description:
      'Fallback transport mode for the OpenAI provider (responses/chat)',
    type: 'enum',
    enumValues: ['responses', 'chat'],
    persistToProfile: true,
  },
  {
    // Sibling of apiMode / responsesMode / openaiResponsesEnabled: all four
    // feed the same transport resolution in openaiModelPolicy.ts, so they must
    // share one propagation class.
    key: 'responses-mode',
    category: 'cli-behavior',
    owner: 'provider-connection',
    propagation: 'service-reconfigure',
    description:
      'Global fallback transport mode for OpenAI when apiMode and responsesMode are unset (responses/chat)',
    type: 'enum',
    enumValues: ['responses', 'chat'],
    persistToProfile: true,
  },
  {
    key: 'openaiResponsesEnabled',
    category: 'provider-config',
    owner: 'provider-connection',
    propagation: 'service-reconfigure',
    description:
      'Force-enable the OpenAI Responses API on non-canonical base URLs',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'reasoning.enabled',
    category: 'model-behavior',
    owner: 'model',
    propagation: 'next-turn',
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
    owner: 'model',
    propagation: 'next-turn',
    description:
      'How much the model should think before responding (minimal/low/medium/high/xhigh/max)',
    type: 'enum',
    enumValues: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    persistToProfile: true,
  },
  {
    key: 'reasoning.effortWireFormat',
    category: 'model-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description: 'Request wire format for generic reasoning effort',
    type: 'enum',
    enumValues: [
      'auto',
      'openai',
      'openai-responses',
      'anthropic',
      'anthropic-budget',
      'openrouter',
      'gemini',
      'template-kwargs',
      'none',
    ],
    persistToProfile: true,
  },
  {
    key: 'reasoning.enabledWireFormat',
    category: 'model-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description: 'Request wire format for generic reasoning enablement',
    type: 'enum',
    enumValues: [
      'auto',
      'openai',
      'openai-responses',
      'openrouter',
      'thinking',
      'gemini',
      'template-kwargs',
      'none',
    ],
    persistToProfile: true,
  },
  {
    key: 'reasoning.effortMap',
    category: 'model-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description: 'Model-specific mapping from generic reasoning effort values',
    type: 'json',
    persistToProfile: true,
    validate: validateReasoningEffortMap,
  },
  {
    key: 'reasoning.enabledMap',
    category: 'model-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description: 'Model-specific mapping from generic reasoning enablement',
    type: 'json',
    persistToProfile: true,
    validate: validateReasoningEnabledMap,
  },
  {
    key: 'reasoning.maxTokens',
    category: 'model-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description: 'Maximum token budget for reasoning',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'reasoning.budgetTokens',
    category: 'model-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description: 'Token budget for reasoning (Anthropic-specific)',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'reasoning.adaptiveThinking',
    category: 'model-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description:
      'Enable adaptive thinking for Anthropic Opus 4.6+ (true/false)',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'reasoning.includeInResponse',
    category: 'cli-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description: 'Show thinking blocks in UI output',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'reasoning.includeInContext',
    category: 'cli-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description: 'Keep thinking in conversation history',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'reasoning.stripFromContext',
    category: 'cli-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description: 'Remove thinking blocks from context (all/allButLast/none)',
    type: 'enum',
    enumValues: ['all', 'allButLast', 'none'],
    persistToProfile: true,
  },
  {
    key: 'reasoning.format',
    category: 'cli-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description: 'API format for reasoning (native/field)',
    type: 'enum',
    enumValues: ['native', 'field'],
    persistToProfile: true,
  },
  {
    key: 'reasoning.fieldName',
    category: 'cli-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description:
      'Reasoning field name in streaming delta (reasoning_content for OpenAI/vLLM, reasoning for Ollama)',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'reasoning.summary',
    category: 'model-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description:
      'OpenAI Responses API reasoning summary mode (auto/concise/detailed/none)',
    type: 'enum',
    enumValues: ['auto', 'concise', 'detailed', 'none'],
    persistToProfile: true,
  },
  {
    key: 'text.verbosity',
    category: 'model-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description:
      'OpenAI Responses API text verbosity for thinking output (low/medium/high)',
    type: 'enum',
    enumValues: ['low', 'medium', 'high'],
    persistToProfile: true,
  },
  {
    key: 'prompt-caching',
    category: 'model-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description: 'Enable prompt caching (off/5m/1h/24h)',
    type: 'enum',
    enumValues: ['off', '5m', '1h', '24h'],
    persistToProfile: true,
  },
  {
    key: 'responses-stateful',
    category: 'model-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description:
      'Enable Responses API stateful conversations using previous_response_id (true/false)',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'media.pdf.enabled',
    category: 'model-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description:
      'Send PDF files as native input_file data to the model (true/false); when false, PDFs are replaced with a text notice',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'rate-limit-throttle',
    category: 'model-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description: 'Enable proactive rate limit throttling (on/off)',
    type: 'enum',
    enumValues: ['on', 'off'],
    persistToProfile: true,
  },
  {
    key: 'rate-limit-throttle-threshold',
    category: 'model-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description: 'Percentage threshold for rate limit throttling (1-100)',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'rate-limit-max-wait',
    category: 'model-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description: 'Maximum wait time in milliseconds for rate limit throttling',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'shell-replacement',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
    description: 'Command substitution mode for shell tool',
    type: 'string',
    enumValues: ['allowlist', 'all', 'none', 'true', 'false'],
    persistToProfile: true,
  },
  {
    key: 'streaming',
    category: 'cli-behavior',
    owner: 'model',
    propagation: 'next-turn',
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
    owner: 'model',
    propagation: 'next-turn',
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
    owner: 'model',
    propagation: 'next-turn',
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
    owner: 'agent-policy',
    propagation: 'next-turn',
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
    owner: 'agent-policy',
    propagation: 'next-turn',
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
    key: 'image-resize.enabled',
    category: 'cli-behavior',
    owner: 'model',
    propagation: 'next-turn',
    description: 'Enable automatic model-aware resizing for image file reads',
    type: 'boolean',
    persistToProfile: true,
  },
  ...[
    {
      key: 'image-resize.maxLongEdge',
      description: 'Maximum image long edge in pixels',
    },
    {
      key: 'image-resize.maxShortEdge',
      description: 'Maximum image short edge in pixels',
    },
    {
      key: 'image-resize.maxPixels',
      description: 'Maximum total decoded image pixels',
    },
  ].map(
    ({ key, description }): SettingSpec => ({
      key,
      category: 'cli-behavior',
      owner: 'model',
      propagation: 'next-turn',
      description,
      type: 'number',
      hint: 'positive integer pixels',
      persistToProfile: true,
      validate: (value: unknown): ValidationResult => {
        if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
          return { success: true, value };
        }
        return {
          success: false,
          message: `${key} must be a positive integer`,
        };
      },
    }),
  ),
  ...[
    {
      key: 'max-image-dimension',
      description:
        'Hard maximum image width/height in pixels before bytes are rejected (oversized images return a tool error instead of being sent)',
    },
    {
      key: 'max-image-pixels',
      description:
        'Hard maximum total image pixels before bytes are rejected (oversized images return a tool error instead of being sent)',
    },
  ].map(
    ({ key, description }): SettingSpec => ({
      key,
      category: 'model-behavior',
      owner: 'model',
      propagation: 'next-turn',
      description,
      type: 'number',
      hint: 'positive integer pixels',
      persistToProfile: true,
      validate: (value: unknown): ValidationResult => {
        if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
          return { success: true, value };
        }
        return {
          success: false,
          message: `${key} must be a positive integer`,
        };
      },
    }),
  ),
  {
    key: 'tool-output-max-tokens',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
    description: 'Maximum tokens in tool output',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'tool-output-truncate-mode',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
    description: 'How to handle exceeding limits (warn/truncate/sample)',
    type: 'enum',
    enumValues: ['warn', 'truncate', 'sample'],
    persistToProfile: true,
  },
];
