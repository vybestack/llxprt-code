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

/** Shared inactivity timer factory used by both CP and PTY paths. */
export function makeInactivityTimer(
  timeoutMs: number | undefined,
  exitedGuard: { isExited(): boolean },
): {
  reset: () => void;
  controller: AbortController;
} {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | null = null;

  const reset = () => {
    if (timeoutMs === undefined || timeoutMs <= 0 || exitedGuard.isExited()) {
      return;
    }
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      if (!exitedGuard.isExited()) {
        controller.abort('inactivity_timeout');
      }
    }, timeoutMs);
  };

  return { reset, controller };
}
