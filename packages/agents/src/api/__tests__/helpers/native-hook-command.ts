/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  escapeShellArg,
  getShellConfiguration,
} from '@vybestack/llxprt-code-core/utils/shell-utils.js';
import { fileURLToPath } from 'node:url';

export function nativeHookCommand(
  script: string,
  args: readonly string[] = [],
): string {
  const { shell } = getShellConfiguration();
  const invocation = shell === 'powershell' ? '&' : 'exec';
  return `${invocation} ${[process.execPath, script, ...args]
    .map((arg) => escapeShellArg(arg, shell))
    .join(' ')}`;
}

export function nativeHookInputCommand(
  output: string,
  mode: 'write' | 'append',
): string {
  return nativeHookCommand(
    fileURLToPath(new URL('./native-hook-input.ts', import.meta.url)),
    [mode, output],
  );
}
