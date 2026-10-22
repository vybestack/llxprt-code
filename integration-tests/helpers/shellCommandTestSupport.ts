/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getShellConfiguration } from '../../packages/core/src/utils/shell-utils.js';

/**
 * The line-counting command the platform's shell provides, and the executable
 * a `run_shell_command(<tool>)` allowlist entry must name for it.
 */
export function getLineCountCommand(): { command: string; tool: string } {
  const { shell } = getShellConfiguration();
  switch (shell) {
    case 'powershell':
    case 'cmd':
      return { command: `find /c /v`, tool: 'find' };
    case 'bash':
    default:
      return { command: `wc -l`, tool: 'wc' };
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
