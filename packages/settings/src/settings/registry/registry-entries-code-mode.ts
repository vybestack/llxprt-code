/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SettingSpec, ValidationResult } from './registry-types.js';
import { deepFreezeTable } from '../immutableTable.js';

/** Most nested tool calls one script may make (issue #4084). */
export const CODE_MODE_MAX_CALLS_LIMIT = 10_000;
/** Longest wall deadline one script may be given: one hour. */
export const CODE_MODE_WALL_TIMEOUT_LIMIT_MS = 3_600_000;
/** Largest final script value: it enters model history, so 1 MiB at most. */
export const CODE_MODE_MAX_RESULT_BYTES_LIMIT = 1_048_576;

function validatePositiveInteger(
  key: string,
  value: unknown,
  max: number,
  unit: string,
): ValidationResult {
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= max
  ) {
    return { success: true, value };
  }
  return {
    success: false,
    message: `${key} must be a whole number of ${unit} from 1 to ${max}`,
  };
}

function validateChoice(
  key: string,
  value: unknown,
  choices: readonly string[],
): ValidationResult {
  if (typeof value === 'string' && choices.includes(value)) {
    return { success: true, value };
  }
  return {
    success: false,
    message: `${key} must be exactly ${choices.map((choice) => `'${choice}'`).join(' or ')}`,
  };
}

/**
 * Code mode (issue #4084). Application settings: they decide which tools the
 * session advertises and the limits of each script run, and never reach a
 * provider as model parameters. The agent reads them live, so a change
 * applies to the next model request (enablement, surface) or the next script
 * run (limits).
 */
export const REGISTRY_ENTRIES_CODE_MODE: readonly SettingSpec[] =
  deepFreezeTable<readonly SettingSpec[]>([
    {
      key: 'code-mode',
      category: 'cli-behavior',
      owner: 'agent-policy',
      propagation: 'next-turn',
      description:
        "Let the model run short sandboxed JavaScript programs that call read/search tools and foreground shell commands (execute_tool_script, discover_tool_api). 'off' (default) or 'on'",
      type: 'enum',
      enumValues: ['off', 'on'],
      default: 'off',
      persistToProfile: true,
      validate: (value: unknown): ValidationResult =>
        validateChoice('code-mode', value, ['off', 'on']),
    },
    {
      key: 'code-mode-tool-surface',
      category: 'cli-behavior',
      owner: 'agent-policy',
      propagation: 'next-turn',
      description:
        "Tools advertised while code mode is on. 'alongside' (default): every tool plus the two code mode tools. 'compact': the code mode tools plus direct control tools (todos, task, file edits); scripts can still call the hidden read/search tools",
      type: 'enum',
      enumValues: ['alongside', 'compact'],
      default: 'alongside',
      persistToProfile: true,
      validate: (value: unknown): ValidationResult =>
        validateChoice('code-mode-tool-surface', value, [
          'alongside',
          'compact',
        ]),
    },
    {
      key: 'code-mode-max-calls',
      category: 'cli-behavior',
      owner: 'agent-policy',
      propagation: 'next-turn',
      description: `Most tool calls one code mode script may make (1 to ${CODE_MODE_MAX_CALLS_LIMIT}, default: 64). A subagent can lower it, never raise it above its caller's`,
      type: 'number',
      default: 64,
      persistToProfile: true,
      validate: (value: unknown): ValidationResult =>
        validatePositiveInteger(
          'code-mode-max-calls',
          value,
          CODE_MODE_MAX_CALLS_LIMIT,
          'calls',
        ),
    },
    {
      key: 'code-mode-wall-timeout-ms',
      category: 'cli-behavior',
      owner: 'agent-policy',
      propagation: 'next-turn',
      description: `Wall-clock deadline of one code mode script in milliseconds (1 to ${CODE_MODE_WALL_TIMEOUT_LIMIT_MS}, default: 300000), never past the caller's own deadline`,
      type: 'number',
      default: 300_000,
      persistToProfile: true,
      validate: (value: unknown): ValidationResult =>
        validatePositiveInteger(
          'code-mode-wall-timeout-ms',
          value,
          CODE_MODE_WALL_TIMEOUT_LIMIT_MS,
          'milliseconds',
        ),
    },
    {
      key: 'code-mode-max-result-bytes',
      category: 'cli-behavior',
      owner: 'agent-policy',
      propagation: 'next-turn',
      description: `Largest JSON value a code mode script may return, in bytes (1 to ${CODE_MODE_MAX_RESULT_BYTES_LIMIT}, default: 16384). Larger values fail with RESULT_TOO_LARGE`,
      type: 'number',
      default: 16_384,
      persistToProfile: true,
      validate: (value: unknown): ValidationResult =>
        validatePositiveInteger(
          'code-mode-max-result-bytes',
          value,
          CODE_MODE_MAX_RESULT_BYTES_LIMIT,
          'bytes',
        ),
    },
  ]);
