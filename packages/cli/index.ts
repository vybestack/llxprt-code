#!/usr/bin/env -S bun

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FatalError, writeToStderr } from '@vybestack/llxprt-code-core';
import { runBunLauncherIfNeeded } from './src/launcher/bun-launcher.js';
import {
  applyProcessMemoryHardening,
  HARDENING_FAILURE_EXIT_CODE,
} from './src/launcher/process-memory-hardening.js';
import {
  appendStartupFatalLog,
  buildStartupFatalRecord,
  formatStartupFatalMessage,
  pauseBeforeExitIfNeeded,
} from './src/utils/startup-fatal-log.js';

// --- Global Entry Point ---

// Suppress known race condition error in node-pty on Windows
// Tracking bug: https://github.com/microsoft/node-pty/issues/827
process.on('uncaughtException', (error) => {
  if (
    process.platform === 'win32' &&
    error instanceof Error &&
    error.message === 'Cannot resize a pty that has already exited'
  ) {
    // This error happens on Windows with node-pty when resizing a pty that has just exited.
    // It is a race condition in node-pty that we cannot prevent, so we silence it.
    return;
  }

  // For other errors, we rely on the default behavior, but since we attached a listener,
  // we must manually replicate it.
  if (error instanceof Error) {
    writeToStderr(error.stack + '\n');
  } else {
    writeToStderr(String(error) + '\n');
  }
  process.exit(1);
});

function writeFatalError(error: FatalError): void {
  // Persist first (#3566): if the pane dies, the record survives in
  // <logHome>/fatal.log. Persistence must never mask the original fatal:
  // appendStartupFatalLog reports fs failures via its result, and the attempt
  // itself (process.cwd() throws on a deleted cwd, or record construction
  // fails) is guarded here because an escaping throw would land in
  // writeCriticalErrorAndGetExitCode's catch, suppressing the message and
  // flipping the exit code (e.g. 44 -> 1).
  let persistResult: { ok: true; path: string } | { ok: false };
  try {
    const record = buildStartupFatalRecord(error, {
      cwd: process.cwd(),
      argv: process.argv,
    });
    persistResult = appendStartupFatalLog(record);
  } catch {
    persistResult = { ok: false };
  }
  let errorMessage = error.message;
  if (!process.env['NO_COLOR']) {
    errorMessage = `\x1b[31m${errorMessage}\x1b[0m`;
  }
  if (persistResult.ok) {
    writeToStderr(
      `${formatStartupFatalMessage(errorMessage, persistResult.path)}\n`,
    );
  } else {
    writeToStderr(`${errorMessage}\n`);
  }
}

function writeUnexpectedCriticalError(error: unknown): void {
  writeToStderr('An unexpected critical error occurred:\n');
  if (error instanceof Error) {
    const stack = error.stack ?? '';
    const detail = stack.includes(error.message)
      ? stack
      : `${error.message}\n${stack}`;
    writeToStderr(`${detail}\n`);
  } else {
    writeToStderr(`${String(error)}\n`);
  }
}

async function safeRunExitCleanup(): Promise<void> {
  try {
    const { runExitCleanup } = await import('./src/utils/cleanup.js');
    await runExitCleanup();
  } catch {
    // Best-effort: cleanup must not mask the original error.
  }
}

function writeCriticalErrorAndGetExitCode(error: unknown): {
  exitCode: number;
  fatal: boolean;
} {
  try {
    if (error instanceof FatalError) {
      writeFatalError(error);
      return { exitCode: error.exitCode, fatal: true };
    }
    writeUnexpectedCriticalError(error);
  } catch {
    return { exitCode: 1, fatal: false };
  }
  return { exitCode: 1, fatal: false };
}

/**
 * Shared terminal path for critical errors: report, run best-effort cleanup,
 * pause (fatals only, when stderr is a TTY and --no-pause is absent) so the
 * message stays readable in closing panes, then exit with the original code.
 */
async function exitAfterCriticalError(error: unknown): Promise<never> {
  const { exitCode, fatal } = writeCriticalErrorAndGetExitCode(error);
  await safeRunExitCleanup();
  if (fatal) {
    await pauseBeforeExitIfNeeded(process.argv, process.stderr.isTTY === true);
  }
  process.exit(exitCode);
}

// Use writeToStderr instead of console.error so that fatal errors are always
// visible even after patchStdio() has redirected process.stderr.write to the
// internal event bus (which may not have listeners yet).  Fixes #1667 where
// config validation errors were silently swallowed.
//
// --- Bun launcher bootstrap ---
// Re-exec under Bun when not already running under it. This must happen before
// importing the (heavy) CLI so that Bun runs the TypeScript entry directly.
// Dynamic import keeps main() out of the module graph until the launcher decides
// whether to relaunch. The imported CLI module must remain side-effect-free at
// module scope; if import fails here, main() never started and there are no CLI
// runtime resources for safeRunExitCleanup() to release.
runBunLauncherIfNeeded()
  .then(async () => {
    // Mark the process non-dumpable before importing the CLI so the credential
    // proxy token and provider keys — which land in this process's address
    // space once the CLI runs — cannot be read by an in-container process via
    // /proc/<pid>/mem. No-op off Linux or when neither sandboxed nor
    // credential-bearing; fails closed (FatalError) if hardening fails while
    // credential-bearing, warns and continues otherwise. See issue #3028.
    // The hardening module returns an abort reason rather than throwing so it
    // stays free of package imports at this earliest bootstrap point; the
    // fatal-error policy lives here.
    const { abortReason } = await applyProcessMemoryHardening();
    if (abortReason !== undefined) {
      throw new FatalError(abortReason, HARDENING_FAILURE_EXIT_CODE);
    }
    const { main } = await import('./src/cli.js');
    try {
      await main();
    } catch (error) {
      await exitAfterCriticalError(error);
    }
  })
  .catch(async (error: unknown) => {
    // This covers launcher failures and bootstrap import failures before main()
    // starts. Cleanup is best-effort and harmless if nothing was registered.
    // The finally guarantees process.exit always happens even if the shared
    // helper itself throws unexpectedly.
    try {
      await exitAfterCriticalError(error);
    } finally {
      process.exit(1);
    }
  });
