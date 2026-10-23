/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getShellConfiguration } from '../../packages/core/src/utils/shell-utils.js';

/**
 * The complete command that counts the lines of `file` in the platform's
 * shell, and the executable a `run_shell_command(<tool>)` allowlist entry must
 * name for it. PowerShell has no `wc`, and its `find` resolves to the native
 * string-search executable, so it counts with `Measure-Object`.
 */
export function getLineCountCommand(file: string): {
  command: string;
  tool: string;
} {
  const { shell } = getShellConfiguration();
  switch (shell) {
    case 'powershell':
      return {
        command: `(Get-Content -LiteralPath '${file.replaceAll("'", "''")}' | Measure-Object -Line).Lines`,
        tool: 'Get-Content',
      };
    case 'cmd':
      return { command: `find /c /v "" "${file}"`, tool: 'find' };
    case 'bash':
    default:
      return { command: `wc -l "${file}"`, tool: 'wc' };
  }
}

/**
 * How the platform's shell, as the shell tool itself selects it, expands the
 * environment variable `name`, with a human-readable shell label for prompts.
 */
export function getEnvVarEchoCommand(name: string): {
  command: string;
  shellLabel: string;
} {
  const { shell } = getShellConfiguration();
  switch (shell) {
    case 'powershell':
      return { command: `echo $env:${name}`, shellLabel: 'PowerShell' };
    case 'cmd':
      return { command: `echo %${name}%`, shellLabel: 'cmd.exe' };
    case 'bash':
    default:
      return { command: `echo $${name}`, shellLabel: 'bash' };
  }
}
