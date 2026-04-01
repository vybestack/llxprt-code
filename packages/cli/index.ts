#!/usr/bin/env -S node --no-deprecation

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Note: Using --no-deprecation in shebang to suppress deprecation warnings from dependencies

import { main } from './src/gemini.js';
import { FatalError, writeToStderr } from '@vybestack/llxprt-code-core';
import { runExitCleanup } from './src/utils/cleanup.js';

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

// Use writeToStderr instead of console.error so that fatal errors are always
// visible even after patchStdio() has redirected process.stderr.write to the
// internal event bus (which may not have listeners yet).  Fixes #1667 where
// config validation errors were silently swallowed.
main().catch(async (error) => {
  await runExitCleanup();
  if (error instanceof FatalError) {
    let errorMessage = error.message;
    if (!process.env['NO_COLOR']) {
      errorMessage = `\x1b[31m${errorMessage}\x1b[0m`;
    }
    writeToStderr(`${errorMessage}\n`);
    process.exit(error.exitCode);
  }
  writeToStderr('An unexpected critical error occurred:\n');
  if (error instanceof Error) {
    writeToStderr(`${error.stack}\n`);
  } else {
    writeToStderr(`${String(error)}\n`);
  }
  process.exit(1);
});
