/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import * as path from 'node:path';

/** Which directory level is missing when the journal write hit ENOENT. */
function diagnoseMissingPath(chatsDir: string): {
  chatsDirExists: boolean;
  parentDir: string;
  parentDirExists: boolean;
  grandparentDir: string;
  grandparentDirExists: boolean;
} {
  const parentDir = path.dirname(chatsDir);
  const grandparentDir = path.dirname(parentDir);
  return {
    chatsDirExists: existsSync(chatsDir),
    parentDir,
    parentDirExists: existsSync(parentDir),
    grandparentDir,
    grandparentDirExists: existsSync(grandparentDir),
  };
}

/** The log message for a journal write that failed and stopped recording. */
export function describeDrainFailure(
  error: unknown,
  filePath: string | null,
  chatsDir: string,
): string {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    const diag = diagnoseMissingPath(chatsDir);
    return (
      '[SessionRecording] ENOENT writing session file \u2014 recording stopped.\n' +
      `  filePath: ${filePath}\n` +
      `  chatsDir exists: ${diag.chatsDirExists}\n` +
      `  parentDir exists: ${diag.parentDirExists} (${diag.parentDir})\n` +
      `  grandparentDir exists: ${diag.grandparentDirExists} (${diag.grandparentDir})\n` +
      '  This directory was removed mid-session by an external process or AI shell command.'
    );
  }
  return (
    '[SessionRecording] Unexpected error writing session file \u2014 recording stopped.\n' +
    `  filePath: ${filePath}\n` +
    `  error: ${error}`
  );
}
