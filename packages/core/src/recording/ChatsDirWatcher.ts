/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * chatsDir watch for the session recording service.
 *
 * Watches the chats directory for rename/deletion events so a mid-session
 * removal is diagnosable with an exact timestamp, and diagnoses which
 * directory level is missing when a journal append fails with ENOENT
 * (PLAN-20260211-SESSIONRECORDING.P05).
 *
 * Extracted from SessionRecordingService for file size
 * (PLAN-20260917-ISSUE854.P05b2); behaviour is unchanged.
 */

import { existsSync, watch, watchFile, unwatchFile, type Stats } from 'node:fs';
import * as path from 'node:path';
import { debugLogger } from '../utils/debugLogger.js';

export interface ChatsDirWatchHandle {
  close(): void;
}

/** Diagnose which directory level is missing when ENOENT occurs. */
export function diagnoseMissingPath(chatsDir: string): {
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

function handleChatsDirChange(
  watchDir: string,
  sessionId: string,
  filePath: string | null,
): void {
  if (existsSync(watchDir)) {
    return;
  }
  debugLogger.error(
    `[SessionRecording] chatsDir was removed at ${new Date().toISOString()}!\n` +
      `  path: ${watchDir}\n` +
      `  sessionId: ${sessionId}\n` +
      `  filePath: ${filePath}\n` +
      `  Check the preceding shell command for the culprit.`,
  );
}

/**
 * Watch the chatsDir for rename/deletion events.
 * When the directory is removed mid-session, this fires and logs the
 * exact timestamp so it can be correlated with the shell command log.
 * Returns null when watching fails (e.g. directory already gone).
 */
export function watchChatsDir(
  chatsDir: string,
  sessionId: string,
  currentFilePath: () => string | null,
  onWatcherError?: () => void,
): ChatsDirWatchHandle | null {
  try {
    if (process.platform === 'win32') {
      const listener = (currentStats: Stats): void => {
        if (currentStats.nlink === 0) {
          handleChatsDirChange(chatsDir, sessionId, currentFilePath());
        }
      };
      watchFile(chatsDir, { persistent: false, interval: 100 }, listener);
      return {
        close: () => unwatchFile(chatsDir, listener),
      };
    }

    const watcher = watch(chatsDir, { persistent: false }, (eventType) => {
      if (eventType === 'rename') {
        handleChatsDirChange(chatsDir, sessionId, currentFilePath());
      }
    });
    let closed = false;
    watcher.on('error', () => {
      watcher.close();
      onWatcherError?.();
    });
    return {
      close: () => {
        if (!closed) {
          closed = true;
          watcher.close();
        }
      },
    };
  } catch {
    // If watch fails (e.g. directory already gone), silently skip
    return null;
  }
}
