/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Typed reader for the code mode settings (issue #4084). The settings
 * registry validates `/set`, `--set` and profile values at admission; this
 * reader validates again at use and fails with the registry's message, so a
 * hand-edited profile cannot run code mode with a value nobody checked.
 */

import {
  getSettingSpec,
  validateSetting,
} from '@vybestack/llxprt-code-settings/settings/settingsRegistry.js';

export type CodeModeSurface = 'alongside' | 'compact';

/** The limits a user or profile may set for one script run. */
export interface CodeModeSettingLimits {
  readonly maxCalls: number;
  readonly wallTimeoutMs: number;
  readonly maxResultBytes: number;
}

/** What the session advertises; read for every lookup and publication. */
export interface CodeModeSettings {
  readonly enabled: boolean;
  readonly surface: CodeModeSurface;
}

/** Reads one setting's current value (the session settings owner). */
export type SettingRead = (key: string) => unknown;

function read<T>(readSetting: SettingRead, key: string): T {
  const value = readSetting(key);
  if (value === undefined) return getSettingSpec(key)?.default as T;
  const validation = validateSetting(key, value);
  if (!validation.success)
    throw new Error(
      `Invalid code mode setting: ${validation.message ?? key}. Fix it with /set ${key} <value>.`,
    );
  return validation.value as T;
}

/**
 * Whether code mode is on and which surface it shows. `hostDefault` is the
 * agent host's choice (`AgentConfig.codeMode`) for a session whose
 * `code-mode` setting is unset.
 */
export function readCodeModeSettings(
  readSetting: SettingRead,
  hostDefault: boolean,
): CodeModeSettings {
  const mode = readSetting('code-mode');
  return Object.freeze({
    enabled:
      mode === undefined
        ? hostDefault
        : read<'off' | 'on'>(readSetting, 'code-mode') === 'on',
    surface: read<CodeModeSurface>(readSetting, 'code-mode-tool-surface'),
  });
}

/** The limits of a script run started now; read once per run. */
export function readCodeModeLimits(
  readSetting: SettingRead,
): CodeModeSettingLimits {
  return Object.freeze({
    maxCalls: read<number>(readSetting, 'code-mode-max-calls'),
    wallTimeoutMs: read<number>(readSetting, 'code-mode-wall-timeout-ms'),
    maxResultBytes: read<number>(readSetting, 'code-mode-max-result-bytes'),
  });
}

/** A subagent may lower its caller's limits, never raise them. */
export function lowerCodeModeLimits(
  own: CodeModeSettingLimits,
  caller: CodeModeSettingLimits,
): CodeModeSettingLimits {
  return Object.freeze({
    maxCalls: Math.min(own.maxCalls, caller.maxCalls),
    wallTimeoutMs: Math.min(own.wallTimeoutMs, caller.wallTimeoutMs),
    maxResultBytes: Math.min(own.maxResultBytes, caller.maxResultBytes),
  });
}

/**
 * The wall timeout of a run started now: the setting, but never past the
 * caller's own deadline (epoch milliseconds). A deadline already passed
 * leaves one millisecond, so the run ends at once with TIMEOUT.
 */
export function boundWallTimeout(
  wallTimeoutMs: number,
  deadline: number | undefined,
  now: number = Date.now(),
): number {
  if (deadline === undefined) return wallTimeoutMs;
  return Math.max(1, Math.min(wallTimeoutMs, Math.floor(deadline - now)));
}
