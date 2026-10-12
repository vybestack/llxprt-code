/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  escapeShellArg,
  getShellConfiguration,
} from '../../utils/shell-utils.js';

export function physicalHookCommand(script: string): string {
  const { shell } = getShellConfiguration();
  const invocation = shell === 'powershell' ? '&' : 'exec';
  return `${invocation} ${escapeShellArg(process.execPath, shell)} ${escapeShellArg(script, shell)}`;
}
