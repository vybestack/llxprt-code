/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  escapeShellArg,
  getShellConfiguration,
} from '@vybestack/llxprt-code-core/utils/shell-utils.js';

/**
 * Builds the hook `command` that runs a TypeScript hook script under Bun using
 * the invocation and quoting of the shell the hook runner will actually select
 * (bash `exec` on POSIX, PowerShell call operator on Windows).
 */
export function physicalHookCommand(script: string): string {
  const { shell } = getShellConfiguration();
  const invocation = shell === 'powershell' ? '&' : 'exec';
  return `${invocation} ${escapeShellArg(process.execPath, shell)} ${escapeShellArg(script, shell)}`;
}
