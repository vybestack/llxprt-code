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
    owner: 'agent-policy',
    propagation: 'next-turn',
    description: 'Maximum size per item/file in bytes',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'max-prompt-tokens',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
    description: 'Maximum tokens allowed in any prompt sent to LLM',
    type: 'number',
    persistToProfile: true,
  },
  {
    key: 'maxTurnsPerPrompt',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
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
    owner: 'agent-policy',
    propagation: 'next-turn',
    description: 'Enable/disable all loop detection mechanisms (true/false)',
    type: 'boolean',
    persistToProfile: true,
    default: true,
  },
  {
    key: 'toolCallLoopThreshold',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
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
    owner: 'agent-policy',
    propagation: 'next-turn',
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
    owner: 'agent-policy',
    propagation: 'next-turn',
    description: 'Maximum number of retry attempts for API calls',
    type: 'number',
    hint: 'non-negative integer (e.g., 3)',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message: 'retries must be a non-negative integer (e.g., 3)',
      };
    },
  },
  {
    key: 'retrywait',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
    description: 'Initial delay in milliseconds between retry attempts',
    type: 'number',
    hint: 'positive integer in milliseconds (e.g., 5000 for 5 seconds)',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'retrywait must be a positive integer in milliseconds (e.g., 5000 for 5 seconds)',
      };
    },
  },
  {
    key: 'auth-retry-timeout',
    category: 'cli-behavior',
    owner: 'provider-connection',
    propagation: 'next-turn',
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
    owner: 'provider-connection',
    propagation: 'next-turn',
    description: 'Request timeout in milliseconds for local AI servers',
    type: 'number',
    hint: 'positive integer in milliseconds (e.g., 60000)',
    persistToProfile: true,
  },
  {
    key: 'socket-keepalive',
    category: 'cli-behavior',
    owner: 'provider-connection',
    propagation: 'next-turn',
    description: 'Enable TCP keepalive for local AI server connections',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'socket-nodelay',
    category: 'cli-behavior',
    owner: 'provider-connection',
    propagation: 'next-turn',
    description: 'Enable TCP_NODELAY for local AI servers',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'emojifilter',
    category: 'cli-behavior',
    owner: 'application',
    propagation: 'profile-transition',
    description: 'Emoji filter mode (allowed/auto/warn/error)',
    type: 'enum',
    enumValues: ['allowed', 'auto', 'warn', 'error'],
    persistToProfile: false,
    parse: (raw: string) => raw.toLowerCase(),
  },
  {
    key: 'dumponerror',
    category: 'cli-behavior',
    owner: 'application',
    propagation: 'profile-transition',
    description:
      'Dump API request body to the dumps directory in your LLxprt cache directory on errors (enabled/disabled)',
    type: 'enum',
    enumValues: ['enabled', 'disabled'],
    persistToProfile: false,
  },
  {
    key: 'dumpcontext',
    category: 'cli-behavior',
    owner: 'application',
    propagation: 'profile-transition',
    description: 'Control context dumping (now/status/on/error/off)',
    type: 'enum',
    enumValues: ['now', 'status', 'on', 'error', 'off'],
    persistToProfile: false,
    sessionScope: true,
  },
  {
    key: 'authOnly',
    category: 'cli-behavior',
    owner: 'provider-connection',
    propagation: 'next-turn',
    description: 'Force OAuth authentication only',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'auth.noBrowser',
    category: 'cli-behavior',
    owner: 'provider-connection',
    propagation: 'next-turn',
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
    owner: 'agent-policy',
    propagation: 'next-turn',
    description: 'Enable todo continuation mode',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'tools.disabled',
    aliases: ['disabled-tools'],
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
    description: 'Disabled tools list',
    type: 'string-array',
    persistToProfile: true,
  },
  {
    key: 'tools.allowed',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
    description: 'Allowed tools list',
    type: 'string-array',
    persistToProfile: true,
  },
  {
    key: 'stream-options',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
    description: 'Stream options for OpenAI API',
    type: 'json',
    persistToProfile: true,
  },
  {
    key: 'include-folder-structure',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
    description: 'Include folder structure in system prompts',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'enable-tool-prompts',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
    description: 'Load tool-specific prompts from <config>/prompts/tools/**',
    type: 'boolean',
    persistToProfile: true,
  },
  {
    key: 'model.canSaveCore',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
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
    owner: 'agent-policy',
    propagation: 'next-turn',
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
    owner: 'agent-policy',
    propagation: 'next-turn',
    description: 'Default timeout in seconds for task tool executions',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (
        typeof value === 'number' &&
        (value === -1 || (Number.isFinite(value) && value > 0))
      ) {
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
    owner: 'agent-policy',
    propagation: 'next-turn',
    description: 'Maximum allowed timeout in seconds for task tool executions',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (
        typeof value === 'number' &&
        (value === -1 || (Number.isFinite(value) && value > 0))
      ) {
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
    owner: 'agent-policy',
    propagation: 'next-turn',
    description:
      'Maximum concurrent async tasks. Default 5, use -1 for unlimited.',
    type: 'number',
    persistToProfile: true,
    validate: validateTaskMaxAsync,
  },
  {
    // #1995 slice 2
    key: 'shell-max-background-jobs',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
    description:
      'Maximum concurrent managed background shell jobs. Default 10, use -1 for unlimited.',
    type: 'number',
    default: 10,
    persistToProfile: true,
    validate: validateShellMaxBackgroundJobs,
  },
  {
    // #1995 slice 2
    key: 'shell-background-log-max-bytes',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
    description:
      'Maximum log file size in bytes for managed background shell jobs. A job exceeding this cap is failed. Default 8388608 (8 MiB).',
    type: 'number',
    default: 8388608,
    persistToProfile: true,
    validate: validateShellBackgroundLogMaxBytes,
  },
  {
    key: 'subagents.async.enabled',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
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
    owner: 'agent-policy',
    propagation: 'next-turn',
    description: 'Default timeout in seconds for shell command executions',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (
        typeof value === 'number' &&
        (value === -1 || (Number.isFinite(value) && value > 0))
      ) {
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
    owner: 'agent-policy',
    propagation: 'next-turn',
    description:
      'Maximum allowed timeout in seconds for shell command executions',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (
        typeof value === 'number' &&
        (value === -1 || (Number.isFinite(value) && value > 0))
      ) {
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
    owner: 'agent-policy',
    propagation: 'next-turn',
    description:
      'Inactivity timeout in seconds for shell commands. Kills commands that produce no output for this duration. Resets on each output event.',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (
        typeof value === 'number' &&
        (value === -1 || (Number.isFinite(value) && value > 0))
      ) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'shell-inactivity-timeout-seconds must be a positive number in seconds or -1 for unlimited',
      };
    },
  },
  {
    key: 'shell-output-retention-max-bytes',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
    description:
      'Maximum bytes of shell output retained in memory during acquisition. Output beyond this is head/tail truncated with a visible notice. Also constrains PTY display scrollback when its byte-derived limit is lower than ptyScrollbackLimit. Separate from model token limits.',
    type: 'number',
    persistToProfile: true,
    validate: (value: unknown): ValidationResult => {
      if (
        typeof value === 'number' &&
        (value === -1 || (Number.isFinite(value) && value > 0))
      ) {
        return { success: true, value };
      }
      return {
        success: false,
        message:
          'shell-output-retention-max-bytes must be a positive number in bytes or -1 for the hard maximum',
      };
    },
  },
  {
    key: 'token-usage-log',
    category: 'cli-behavior',
    owner: 'application',
    propagation: 'next-turn',
    description:
      'Log estimate-vs-actual token usage per turn to a per-session JSONL file (counts only, no prompt text)',
    type: 'boolean',
    default: true,
    persistToProfile: true,
    completionOptions: [
      { value: 'true', description: 'Enable per-turn token usage logging' },
      { value: 'false', description: 'Disable per-turn token usage logging' },
    ],
  },
  {
    key: 'mcp.lazy',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
    description:
      'Defer MCP server tool schemas from the model until a server is activated via the activate_mcp_server tool. ' +
      'Reduces token overhead for large MCP tool sets.',
    type: 'boolean',
    default: false,
    persistToProfile: true,
    completionOptions: [
      { value: 'true', description: 'Enable lazy MCP schema loading' },
      {
        value: 'false',
        description: 'Publish all MCP schemas eagerly (default)',
      },
    ],
  },
  {
    key: 'mcp.eagerServers',
    category: 'cli-behavior',
    owner: 'agent-policy',
    propagation: 'next-turn',
    description:
      'List of MCP server names that stay eager (schemas always published) while mcp.lazy is enabled.',
    type: 'string-array',
    persistToProfile: true,
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

function validateShellMaxBackgroundJobs(value: unknown): ValidationResult {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return {
      success: false,
      message:
        'shell-max-background-jobs must be -1 (unlimited) or a positive integer',
    };
  }
  if (value === -1 || value >= 1) {
    return { success: true, value };
  }
  return {
    success: false,
    message:
      'shell-max-background-jobs must be -1 (unlimited) or a positive integer',
  };
}

function validateShellBackgroundLogMaxBytes(value: unknown): ValidationResult {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1024) {
    return {
      success: false,
      message:
        'shell-background-log-max-bytes must be an integer of at least 1024',
    };
  }
  return { success: true, value };
}
