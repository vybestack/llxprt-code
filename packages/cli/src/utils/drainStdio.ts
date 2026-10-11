/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeToStderr, writeToStdout } from '@vybestack/llxprt-code-core';

function drain(
  write: (callback: (err?: Error | null) => void) => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Writes complete in order, so the callback of an empty write fires only
    // after every earlier write to the same stream has been handed to the OS.
    write((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Resolves once everything already written through writeToStdout and
 * writeToStderr has been flushed. When these streams are pipes the writes can
 * still be queued, and process.exit would truncate them. A stream error
 * rejects instead of being swallowed.
 */
export async function drainStdio(): Promise<void> {
  await Promise.all([
    drain((callback) => writeToStdout('', callback)),
    drain((callback) => writeToStderr('', 'utf8', callback)),
  ]);
}
