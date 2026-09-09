/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3566 — durable startup-fatal logging. When a FatalError aborts the
 * launch, terminal panes in multiplexed workflows often die before the user
 * can read the diagnosis; these helpers append a JSONL record to
 * `<logHome>/fatal.log`, point the user at it on stderr, and briefly pause
 * before exit when stderr is a TTY so the message stays readable.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { FatalError } from '@vybestack/llxprt-code-core';
import { writeToStderr } from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-storage';

export interface StartupFatalRecord {
  timestamp: string;
  cwd: string;
  argv: string[];
  exitCode: number;
  message: string;
}

export const STARTUP_FATAL_PAUSE_MS = 5000;

export function resolveStartupFatalLogPath(): string {
  // Resolved at call time so LLXPRT_LOG_HOME overrides are honored (tests).
  return path.join(Storage.getGlobalLogDir(), 'fatal.log');
}

/** A `--key` token (no `=`) that consumes the following token as its value. */
function isBareKeyToken(token: string): boolean {
  return (
    token.startsWith('--') && token.length > 2 && token.indexOf('=') === -1
  );
}

// Value-taking short flags, hardcoded to mirror the prompt/prompt-interactive
// aliases registered in config/yargsOptions.ts; importing that table would
// break this module's dependency-free invariant. Without them, `llxprt -p
// SECRET` would leak the credential into fatal.log.
const VALUE_TAKING_SHORT_FLAGS: readonly string[] = ['-p', '-i'];

function isValueTakingShortFlag(token: string): boolean {
  return VALUE_TAKING_SHORT_FLAGS.includes(token);
}

/**
 * Replaces the value after a `--key` token and the value inside
 * `--key=<value>` with '[REDACTED]'; the -p/-i prompt aliases get the same
 * treatment in both bare and `=` forms. All other tokens pass through
 * verbatim. A `--`-prefixed token after a bare `--key` is the next flag, not
 * a value, so it passes through; likewise any `-`-prefixed token after a
 * value-taking short flag. A genuine value token is still redacted.
 * Returns a new array and never mutates the input.
 */
export function redactArgvForLog(argv: readonly string[]): string[] {
  return argv.map((token, index) => {
    const previous = index > 0 ? argv[index - 1] : undefined;
    if (previous !== undefined) {
      if (isBareKeyToken(previous) && !token.startsWith('--')) {
        return '[REDACTED]';
      }
      if (isValueTakingShortFlag(previous) && !token.startsWith('-')) {
        return '[REDACTED]';
      }
    }
    const equalsIndex = token.indexOf('=');
    if (equalsIndex !== -1 && token.startsWith('--')) {
      return `${token.slice(0, equalsIndex + 1)}[REDACTED]`;
    }
    if (
      equalsIndex !== -1 &&
      isValueTakingShortFlag(token.slice(0, equalsIndex))
    ) {
      return `${token.slice(0, equalsIndex + 1)}[REDACTED]`;
    }
    return token;
  });
}

export function buildStartupFatalRecord(
  error: FatalError,
  context: { cwd: string; argv: readonly string[]; now?: () => Date },
): StartupFatalRecord {
  const now = context.now ?? ((): Date => new Date());
  return {
    timestamp: now().toISOString(),
    cwd: context.cwd,
    argv: redactArgvForLog(context.argv),
    exitCode: error.exitCode,
    message: error.message,
  };
}

/**
 * Appends the record as one JSONL line, creating the log dir/file if absent.
 * Never throws: this runs on the crash-reporting path against external
 * filesystem state and must not mask the original fatal error, so any fs
 * failure is reported via `{ ok: false }` and the caller falls back to the
 * pre-existing output.
 */
export function appendStartupFatalLog(
  record: StartupFatalRecord,
): { ok: true; path: string } | { ok: false } {
  try {
    const logPath = resolveStartupFatalLogPath();
    mkdirSync(path.dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify(record)}\n`);
    return { ok: true, path: logPath };
  } catch {
    return { ok: false };
  }
}

export function formatStartupFatalMessage(
  message: string,
  logPath: string,
): string {
  return `${message}\nFull error details saved to: ${logPath}`;
}

export function shouldPauseBeforeExit(
  argv: readonly string[],
  stderrIsTty: boolean,
): boolean {
  return stderrIsTty && !argv.includes('--no-pause');
}

/**
 * Pauses briefly before exit so the fatal message stays visible in terminal
 * panes that close on process exit. Never rejects: a crash-path helper must
 * not replace the fatal error being reported.
 */
export async function pauseBeforeExitIfNeeded(
  argv: readonly string[],
  stderrIsTty: boolean,
  options: {
    pauseMs?: number;
    sleep?: (ms: number) => Promise<void>;
    writeNotice?: (line: string) => void;
  } = {},
): Promise<void> {
  if (!shouldPauseBeforeExit(argv, stderrIsTty)) {
    return;
  }
  const writeNotice =
    options.writeNotice ??
    ((line: string): void => {
      writeToStderr(`${line}\n`);
    });
  const sleep =
    options.sleep ??
    ((ms: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }));
  try {
    writeNotice(
      'Pausing briefly before exit so this message stays readable; pass --no-pause to skip.',
    );
    await sleep(options.pauseMs ?? STARTUP_FATAL_PAUSE_MS);
  } catch {
    // Swallowed deliberately: see function doc.
  }
}
