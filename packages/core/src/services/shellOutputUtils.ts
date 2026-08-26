/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import stripAnsi from 'strip-ansi';
import type { ShellType } from '../utils/shell-utils.js';

const ANSI_ESCAPE = '\u001b';
const ANSI_CSI = '\u009b';

export const MAX_SNIFF_SIZE = 4096;

export function stripAnsiIfPresent(value: string): string {
  return value.includes(ANSI_ESCAPE) || value.includes(ANSI_CSI)
    ? stripAnsi(value)
    : value;
}

const BASH_SHOPT_OPTIONS = 'promptvars nullglob extglob nocaseglob dotglob';
const BASH_SHOPT_GUARD = `shopt -u ${BASH_SHOPT_OPTIONS};`;

export function ensurePromptvarsDisabled(
  command: string,
  shell: ShellType,
): string {
  if (shell !== 'bash') {
    return command;
  }

  const trimmed = command.trimStart();
  if (trimmed.startsWith(BASH_SHOPT_GUARD)) {
    return command;
  }

  return `${BASH_SHOPT_GUARD} ${command}`;
}

// PowerShell -Command does not adopt a native program's exit code (a program
// exiting 42 surfaces as 1). The ladder mirrors hookRunner.ts's
// buildPowerShellExitCodeWrapper (issue #3320): a bare `; exit
// $LASTEXITCODE` would turn PowerShell-level failures (Write-Error,
// command-not-found, where $LASTEXITCODE stays 0/$null) into exit 0.
// `$?` preserves 0 for success, the $LASTEXITCODE branch re-raises native
// N, and the final `exit 1` keeps PS-level failures nonzero. Newline
// separators (not `;`) tolerate a user command ending in `;` (a `;`
// separator would create `;;`, a parse error). The prelude avoids
// `$null -ne 0 -> exit $null -> exit 0` when no native command ran.
const POWERSHELL_EXIT_CODE_PRELUDE = '$global:LASTEXITCODE = 0;';
const POWERSHELL_EXIT_CODE_SUFFIX =
  'if ($?) { exit 0 }\n' +
  'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n' +
  'exit 1';

export function ensureNativeExitCodePropagated(
  command: string,
  shell: ShellType,
): string {
  if (shell !== 'powershell') {
    return command;
  }
  return `${POWERSHELL_EXIT_CODE_PRELUDE}\n${command}\n${POWERSHELL_EXIT_CODE_SUFFIX}`;
}

/**
 * Shared inactivity timer factory used by both CP and PTY paths.
 * Cancellation is terminal: reset() is a no-op after cancel().
 *
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-01
 */
export function makeInactivityTimer(
  timeoutMs: number | undefined,
  exitedGuard: { isExited(): boolean },
): {
  reset: () => void;
  cancel: () => void;
  controller: AbortController;
} {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | null = null;
  let cancelled = false;

  const reset = () => {
    if (
      cancelled ||
      timeoutMs === undefined ||
      timeoutMs <= 0 ||
      exitedGuard.isExited()
    ) {
      return;
    }
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      timeout = null;
      if (!exitedGuard.isExited()) {
        controller.abort('inactivity_timeout');
      }
    }, timeoutMs);
  };

  const cancel = () => {
    cancelled = true;
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return { reset, cancel, controller };
}
