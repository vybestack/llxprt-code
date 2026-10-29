/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  escapeShellArg,
  getShellConfiguration,
} from '../../packages/core/src/utils/shell-utils.js';

/**
 * Builds the hook `command` that runs a script file with the current runtime,
 * using the invocation and quoting of the shell the hook runner selects (bash
 * `exec` on POSIX, the PowerShell call operator on Windows) and an absolute
 * executable path, so no PATH lookup or inline-quoting rule decides the result.
 */
export function scriptHookCommand(scriptPath: string): string {
  const { shell } = getShellConfiguration();
  const invocation = shell === 'powershell' ? '&' : 'exec';
  return `${invocation} ${escapeShellArg(process.execPath, shell)} ${escapeShellArg(scriptPath, shell)}`;
}
