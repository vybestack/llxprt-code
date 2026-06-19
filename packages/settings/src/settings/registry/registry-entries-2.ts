/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SettingSpec, ValidationResult } from './registry-types.js';

export const REGISTRY_ENTRIES_PART_2: readonly SettingSpec[] = [
  {
    key: 'tool-output-item-size-limit',
    category: 'cli-behavior',
    description: 'Maximum size per item/file in bytes',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'max-prompt-tokens',
    category: 'cli-behavior',
    description: 'Maximum tokens allowed in any prompt sent to LLM',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'maxTurnsPerPrompt',
    category: 'cli-behavior',
    description:
      'Maximum number of turns allowed per prompt before stopping (default: -1 for unlimited)',
    type: 'number',
    persistToProfile: true,
    default: -1,
    validate: (value: unknown): ValidationResult => {
      if (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        (value === -1 || value > 0)
      ) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'maxTurnsPerPrompt must be a positive integer or -1 for unlimited',
      };
    },
  },
  {
    key: 'loopDetectionEnabled',
    category: 'cli-behavior',
    description: 'Enable/disable all loop detection mechanisms (true/false)',
    type: 'boolean',
    persistToProfile: true,
    default: true,
  },
  {
    key: 'toolCallLoopThreshold',
    category: 'cli-behavior',
    description:
      'Number of consecutive identical tool calls before triggering loop detection (default: 50, -1 = unlimited)',
    type: 'number',
    persistToProfile: true,
    default: 50,
    validate: (value: unknown): ValidationResult => {
      if (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        (value === -1 || value > 0)
      ) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'toolCallLoopThreshold must be a positive integer or -1 for unlimited',
      };
    },
  },
  {
    key: 'contentLoopThreshold',
    category: 'cli-behavior',
    description:
      'Number of content chunk repetitions before triggering loop detection (default: 50, -1 = unlimited)',
    type: 'number',
    persistToProfile: true,
    default: 50,
    validate: (value: unknown): ValidationResult => {
      if (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        (value === -1 || value > 0)
      ) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'contentLoopThreshold must be a positive integer or -1 for unlimited',
      };
    },
  },
  {
    key: 'retries',
    category: 'cli-behavior',
    description: 'Maximum number of retry attempts for API calls',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'retrywait',
    category: 'cli-behavior',
    description: 'Initial delay in milliseconds between retry attempts',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'auth-retry-timeout',
    category: 'cli-behavior',
    description:
      'Timeout in milliseconds for mid-turn OAuth reauthentication attempts',
    type: 'number',
    hint: 'positive integer in milliseconds (default: 30000)',
    persistToProfile: true,
    default: 30000,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'auth-retry-timeout must be a positive integer in milliseconds (e.g., 30000)',
      };
    },
  },

  {
    key: 'socket-timeout',
    category: 'cli-behavior',
    description: 'Request timeout in milliseconds for local AI servers',
    type: 'number',
    hint: 'positive integer in milliseconds (e.g., 60000)',
    persistToProfile: true,
  },
  {
    key: 'socket-keepalive',
    category: 'cli-behavior',
    description: 'Enable TCP keepalive for local AI server connections',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'socket-nodelay',
    category: 'cli-behavior',
    description: 'Enable TCP_NODELAY for local AI servers',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'emojifilter',
    category: 'cli-behavior',
    description: 'Emoji filter mode (allowed/auto/warn/error)',
    type: 'enum',
    enumValues: ['allowed', 'auto', 'warn', 'error'],
    persistToProfile: true,
    parse: (raw: string) => raw.toLowerCase(),
  },
  {
    key: 'dumponerror',
    category: 'cli-behavior',
    description:
      'Dump API request body to ~/.llxprt/dumps/ on errors (enabled/disabled)',
    type: 'enum',
    enumValues: ['enabled', 'disabled'],
    persistToProfile: true,
  },
  {
    key: 'dumpcontext',
    category: 'cli-behavior',
    description: 'Control context dumping (now/status/on/error/off)',
    type: 'enum',
    enumValues: ['now', 'status', 'on', 'error', 'off'],
    persistToProfile: true,
  },
  {
    key: 'authOnly',
    category: 'cli-behavior',
    description: 'Force OAuth authentication only',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'auth.noBrowser',
    category: 'cli-behavior',
    description:
      'Skip automatic browser OAuth flow and prompt for manual code entry',
    type: 'boolean',
    default: false,
    persistToProfile: true,
    completionOptions: [
      { value: 'true', description: 'Force manual OAuth code entry' },
      { value: 'false', description: 'Allow automatic browser launch' },
    ],
  },
  {
    key: 'todo-continuation',
    category: 'cli-behavior',
    description: 'Enable todo continuation mode',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'tools.disabled',
    aliases: ['disabled-tools'],
    category: 'cli-behavior',
    description: 'Disabled tools list',
    type: 'string-array',
    persistToProfile: true,
  },
  {
    key: 'tools.allowed',
    category: 'cli-behavior',
    description: 'Allowed tools list',
    type: 'string-array',
    persistToProfile: true,
  },
  {
    key: 'stream-options',
    category: 'cli-behavior',
    description: 'Stream options for OpenAI API',
    type: 'json',
    persistToProfile: true,
  },
  {
    key: 'include-folder-structure',
    category: 'cli-behavior',
    description: 'Include folder structure in system prompts',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'enable-tool-prompts',
    category: 'cli-behavior',
    description: 'Load tool-specific prompts from ~/.llxprt/prompts/tools/**',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'model.canSaveCore',
    category: 'cli-behavior',
    description:
      'Allow the model to save core (system) memories via save_memory tool. ' +
      'WARNING: Unsafe — the model can override your directives when this is enabled.',
    type: 'boolean',
    default: false,
    persistToProfile: false,
    completionOptions: [
      {
        value: 'true',
        description:
          'Enable (unsafe: model can override your system directives)',
      },
      { value: 'false', description: 'Disable (default, recommended)' },
    ],
  },
  {
    key: 'model.allMemoriesAreCore',
    category: 'cli-behavior',
    description:
      'Load LLXPRT.md files as part of the system prompt instead of user context. ' +
      'Useful for models that strictly follow system directives.',
    type: 'boolean',
    default: false,
    persistToProfile: true,
    completionOptions: [
      {
        value: 'true',
        description: 'Load LLXPRT.md as system directives',
      },
      {
        value: 'false',
        description: 'Load LLXPRT.md as user context (default)',
      },
    ],
  },
  {
    key: 'task-default-timeout-seconds',
    category: 'cli-behavior',
    description: 'Default timeout in seconds for task tool executions',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && (value === -1 || value > 0)) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'task-default-timeout-seconds must be a positive number in seconds or -1 for unlimited',
      };
    },
  },
  {
    key: 'task-max-timeout-seconds',
    category: 'cli-behavior',
    description: 'Maximum allowed timeout in seconds for task tool executions',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && (value === -1 || value > 0)) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'task-max-timeout-seconds must be a positive number in seconds or -1 for unlimited',
      };
    },
  },
  {
    // @plan PLAN-20260130-ASYNCTASK.P21
    // @requirement REQ-ASYNC-012
    key: 'task-max-async',
    category: 'cli-behavior',
    description:
      'Maximum concurrent async tasks. Default 5, use -1 for unlimited.',
    type: 'number',
    persistToProfile: true,
    validate: validateTaskMaxAsync,
  },
  {
    key: 'subagents.async.enabled',
    category: 'cli-behavior',
    description: 'Enable async subagents for this profile.',
    type: 'boolean',
    default: true,
    persistToProfile: true,
    completionOptions: [
      { value: 'true', description: 'Enable async subagents' },
      { value: 'false', description: 'Disable async subagents' },
    ],
  },
  {
    key: 'shell-default-timeout-seconds',
    category: 'cli-behavior',
    description: 'Default timeout in seconds for shell command executions',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && (value === -1 || value > 0)) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'shell-default-timeout-seconds must be a positive number in seconds or -1 for unlimited',
      };
    },
  },
  {
    key: 'shell-max-timeout-seconds',
    category: 'cli-behavior',
    description:
      'Maximum allowed timeout in seconds for shell command executions',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && (value === -1 || value > 0)) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'shell-max-timeout-seconds must be a positive number in seconds or -1 for unlimited',
      };
    },
  },
  {
    key: 'shell-inactivity-timeout-seconds',
    category: 'cli-behavior',
    description:
      'Inactivity timeout in seconds for shell commands. Kills commands that produce no output for this duration. Resets on each output event.',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && (value === -1 || value > 0)) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'shell-inactivity-timeout-seconds must be a positive number in seconds or -1 for unlimited',
      };
    },
  },
];

function validateTaskMaxAsync(value: unknown): ValidationResult {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return {
      success: false,
      message:
        'task-max-async must be -1 (unlimited) or an integer between 1 and 100',
    };
  }
  if (value === -1 || (value >= 1 && value <= 100)) {
    return { success: true, value };
  }
  return {
    success: false,
    message:
      'task-max-async must be -1 (unlimited) or an integer between 1 and 100',
  };
}
