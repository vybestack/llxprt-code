/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { debugLogger } from '../utils/debugLogger.js';
import { diagnoseMissingPath } from './ChatsDirWatcher.js';

/**
 * Reports why a background drain of the recording queue stopped. A missing
 * chats directory gets its own message because it means an external process
 * removed the directory mid-session.
 */
export function logDrainFailure(
  error: unknown,
  filePath: string | null,
  chatsDir: string,
): void {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') {
    const diag = diagnoseMissingPath(chatsDir);
    debugLogger.error(
      `[SessionRecording] ENOENT writing session file — recording stopped.
` +
        `  filePath: ${filePath}
` +
        `  chatsDir exists: ${diag.chatsDirExists}
` +
        `  parentDir exists: ${diag.parentDirExists} (${diag.parentDir})
` +
        `  grandparentDir exists: ${diag.grandparentDirExists} (${diag.grandparentDir})
` +
        `  This directory was removed mid-session by an external process or AI shell command.`,
    );
    return;
  }
  debugLogger.error(
    `[SessionRecording] Unexpected error writing session file — recording stopped.
` +
      `  filePath: ${filePath}
` +
      `  error: ${error}`,
  );
}
