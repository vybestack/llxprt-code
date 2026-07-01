#!/usr/bin/env -S node --no-deprecation

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Note: Using --no-deprecation in shebang to suppress deprecation warnings from dependencies

import { FatalError, writeToStderr } from '@vybestack/llxprt-code-core';
import { runBunLauncherIfNeeded } from './src/launcher/bun-launcher.js';

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
  let errorMessage = error.message;
  if (!process.env['NO_COLOR']) {
    errorMessage = `\x1b[31m${errorMessage}\x1b[0m`;
  }
  writeToStderr(`${errorMessage}\n`);
}

function writeUnexpectedCriticalError(error: unknown): void {
  writeToStderr('An unexpected critical error occurred:\n');
  if (error instanceof Error) {
    writeToStderr(`${error.stack}\n`);
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

function writeCriticalErrorAndGetExitCode(error: unknown): number {
  try {
    if (error instanceof FatalError) {
      writeFatalError(error);
      return error.exitCode;
    }
    writeUnexpectedCriticalError(error);
  } catch {
    return 1;
  }
  return 1;
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
    const { main } = await import('./src/cli.js');
    try {
      await main();
    } catch (error) {
      const exitCode = writeCriticalErrorAndGetExitCode(error);
      await safeRunExitCleanup();
      process.exit(exitCode);
    }
  })
  .catch(async (error: unknown) => {
    // This covers launcher failures and bootstrap import failures before main()
    // starts. Cleanup is best-effort and harmless if nothing was registered.
    let exitCode = 1;
    try {
      exitCode = writeCriticalErrorAndGetExitCode(error);
      await safeRunExitCleanup();
    } finally {
      process.exit(exitCode);
    }
  });
