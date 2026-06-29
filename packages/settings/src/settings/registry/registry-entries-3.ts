/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SettingSpec, ValidationResult } from './registry-types.js';
import { COMPRESSION_STRATEGIES } from './registry-types.js';

export const REGISTRY_ENTRIES_PART_3: readonly SettingSpec[] = [
  {
    key: 'temperature',
    category: 'model-param',
    description: 'Sampling temperature',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'max_tokens',
    aliases: ['max-tokens', 'maxTokens'],
    category: 'model-param',
    description: 'Maximum tokens to generate',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'max_output_tokens',
    aliases: ['max-output-tokens'],
    category: 'model-param',
    description: 'Maximum output tokens (Gemini native param)',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'maxOutputTokens',
    aliases: ['max-output'],
    category: 'cli-behavior',
    description: 'Maximum output tokens (generic, translated by provider)',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'top_p',
    category: 'model-param',
    description: 'Nucleus sampling',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'top_k',
    category: 'model-param',
    description: 'Top-k sampling',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'frequency_penalty',
    category: 'model-param',
    description: 'Frequency penalty',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'presence_penalty',
    category: 'model-param',
    description: 'Presence penalty',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'seed',
    category: 'model-param',
    providers: ['openai', 'openaivercel'],
    description: 'Random seed for deterministic sampling (OpenAI only)',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'stop',
    category: 'model-param',
    description: 'Stop sequences',
    type: 'string-array',
    persistToProfile: true,
  },
  {
    key: 'response_format',
    aliases: ['response-format', 'responseFormat'],
    category: 'model-param',
    description: 'Response format (e.g., json_object)',
    type: 'json',
    persistToProfile: true,
  },
  {
    key: 'logit_bias',
    category: 'model-param',
    description: 'Token bias',
    type: 'json',
    persistToProfile: true,
  },
  {
    key: 'tool_choice',
    aliases: ['tool-choice', 'toolChoice'],
    category: 'model-param',
    description: 'Tool choice strategy (auto/required/none)',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'reasoning',
    category: 'model-param',
    providers: ['openai', 'openaivercel', 'openai-responses'],
    description: 'Reasoning configuration object (OpenAI)',
    type: 'json',
    persistToProfile: false,
    normalize: (value: unknown): unknown => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
      }
      const sanitized: Record<string, unknown> = {};
      const INTERNAL_KEYS = new Set([
        'enabled',
        'includeInContext',
        'includeInResponse',
        'format',
        'stripFromContext',
      ]);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v !== undefined && v !== null && !INTERNAL_KEYS.has(k)) {
          sanitized[k] = v;
        }
      }
      return Object.keys(sanitized).length > 0 ? sanitized : undefined;
    },
  },
  {
    key: 'custom-headers',
    category: 'custom-header',
    description: 'Custom HTTP headers as JSON object',
    type: 'json',
    persistToProfile: true,
  },
  {
    key: 'user-agent',
    aliases: ['User-Agent'],
    category: 'custom-header',
    description: 'User-Agent header override',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'GOOGLE_CLOUD_PROJECT',
    category: 'provider-config',
    description: 'Google Cloud project ID',
    type: 'string',
    persistToProfile: true,
  },
  {
    key: 'GOOGLE_CLOUD_LOCATION',
    category: 'provider-config',
    description: 'Google Cloud location/region',
    type: 'string',
    persistToProfile: true,
  },
  // Load balancer settings (Issue #489)
  {
    key: 'tpm_threshold',
    category: 'cli-behavior',
    description:
      'Minimum tokens per minute before triggering failover (positive integer, load balancer only)',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message: 'tpm_threshold must be a positive integer',
      };
    },
  },
  {
    key: 'timeout_ms',
    category: 'cli-behavior',
    description:
      'Maximum request duration in milliseconds before timeout (positive integer, load balancer only)',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message: 'timeout_ms must be a positive integer',
      };
    },
  },
  {
    key: 'circuit_breaker_enabled',
    category: 'cli-behavior',
    description:
      'Enable circuit breaker pattern for failing backends (true/false, load balancer only)',
    type: 'boolean',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (value === true || value === false) {
        return { success: true, value };
      }
      return {
        success: false,
        message: `circuit_breaker_enabled must be either 'true' or 'false'`,
      };
    },
  },
  {
    key: 'circuit_breaker_failure_threshold',
    category: 'cli-behavior',
    description:
      'Number of failures before opening circuit (positive integer, default: 3, load balancer only)',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message: 'circuit_breaker_failure_threshold must be a positive integer',
      };
    },
  },
  {
    key: 'circuit_breaker_failure_window_ms',
    category: 'cli-behavior',
    description:
      'Time window for counting failures in milliseconds (positive integer, default: 60000, load balancer only)',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message: 'circuit_breaker_failure_window_ms must be a positive integer',
      };
    },
  },
  {
    key: 'circuit_breaker_recovery_timeout_ms',
    category: 'cli-behavior',
    description:
      'Cooldown period before retrying after circuit opens in milliseconds (positive integer, default: 30000, load balancer only)',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'circuit_breaker_recovery_timeout_ms must be a positive integer',
      };
    },
  },
  /** @plan PLAN-20260211-COMPRESSION.P12 */
  {
    key: 'compression.strategy',
    category: 'cli-behavior',
    description:
      'Compression strategy to use (middle-out or top-down-truncation)',
    type: 'enum',
    enumValues: [...COMPRESSION_STRATEGIES],
    default: 'middle-out',
    persistToProfile: true,
  },
  /** @plan PLAN-20260211-COMPRESSION.P12 */
  {
    key: 'compression.profile',
    category: 'cli-behavior',
    description: 'Profile name for compression LLM calls',
    type: 'string',
    persistToProfile: true,
  },
  /**
   * @plan PLAN-20260211-HIGHDENSITY.P15
   * @requirement REQ-HD-009.1, REQ-HD-009.2, REQ-HD-009.3, REQ-HD-009.4
   * @pseudocode settings-factory.md lines 14-51
   */
  {
    key: 'compression.density.readWritePruning',
    category: 'cli-behavior',
    description: 'Enable READ→WRITE pair pruning in high-density strategy',
    type: 'boolean',
    default: true,
    persistToProfile: true,
  },
  {
    key: 'compression.density.fileDedupe',
    category: 'cli-behavior',
    description: 'Enable duplicate @ file inclusion deduplication',
    type: 'boolean',
    default: true,
    persistToProfile: true,
  },
  {
    key: 'compression.density.recencyPruning',
    category: 'cli-behavior',
    description:
      'Enable tool result recency pruning (keep last N per tool type)',
    type: 'boolean',
    default: false,
    persistToProfile: true,
  },
  {
    key: 'compression.density.recencyRetention',
    category: 'cli-behavior',
    description: 'Number of recent results to keep per tool type',
    type: 'number',
    default: 3,
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'compression.density.recencyRetention must be a positive integer (>= 1)',
      };
    },
  },
  {
    key: 'compression.density.compressHeadroom',
    category: 'cli-behavior',
    description:
      'Headroom multiplier for compression target tokens (0 < value <= 1)',
    type: 'number',
    default: 0.6,
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && value > 0 && value <= 1) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'compression.density.compressHeadroom must be a number > 0 and <= 1',
      };
    },
  },
  {
    key: 'compression.density.optimizeThreshold',
    category: 'cli-behavior',
    description:
      'Context usage threshold (0-1) for when density optimization runs. If not set, uses the compression strategy default (e.g., 0.9 for high-density).',
    type: 'number',
    default: undefined,
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (value === undefined || value === null) {
        return { success: true, value: undefined };
      }
      if (typeof value === 'number' && value >= 0 && value <= 1) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'compression.density.optimizeThreshold must be a number >= 0 and <= 1',
      };
    },
  },
  {
    key: 'auth.noBrowser',
    category: 'cli-behavior',
    description: 'Skip automatic browser OAuth flow and use manual code entry',
    type: 'boolean',
    default: false,
    persistToProfile: true,
    completionOptions: [
      { value: 'true', description: 'Disable browser auto-launch for OAuth' },
      { value: 'false', description: 'Allow browser auto-launch for OAuth' },
    ],
  },
  {
    key: 'stream-idle-timeout-ms',
    aliases: ['streamIdleTimeoutMs'],
    category: 'cli-behavior',
    description:
      'Stream idle timeout in milliseconds. Disabled by default (0). Set to a positive number of milliseconds to enable the watchdog.',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'stream-idle-timeout-ms must be a finite number (use 0 or negative to disable)',
      };
    },
  },
];
