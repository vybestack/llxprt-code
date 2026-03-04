#!/usr/bin/env -S node --no-deprecation

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Note: Using --no-deprecation in shebang to suppress deprecation warnings from dependencies

import { main } from './src/gemini.js';
import { FatalError, writeToStderr } from '@vybestack/llxprt-code-core';

// --- Global Entry Point ---
// Use writeToStderr instead of console.error so that fatal errors are always
// visible even after patchStdio() has redirected process.stderr.write to the
// internal event bus (which may not have listeners yet).  Fixes #1667 where
// config validation errors were silently swallowed.
main().catch((error) => {
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
