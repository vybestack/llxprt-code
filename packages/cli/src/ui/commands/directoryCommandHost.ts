/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SessionRecordingEvent } from '@vybestack/llxprt-code-agents';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { DirectoryCommandOperations } from './directoryCommand.js';

/**
 * The workspace-directory operations /directory needs.
 */
export interface DirectoryCommandRuntime {
  addDirectory(path: string): void;
  directories(): readonly string[];
  getFolderTrust(): boolean;
  isRestrictiveSandbox(): boolean;
  refreshMemory(): Promise<{ fileCount: number }>;
  shouldLoadMemoryFromIncludeDirectories(): boolean;
}

export function bindDirectoryCommand(
  runtime: DirectoryCommandRuntime | null,
  addDirectoryContext: DirectoryCommandOperations['addDirectoryContext'],
  recordDirectoriesChanged: DirectoryCommandOperations['recordDirectoriesChanged'],
  addItem: UseHistoryManagerReturn['addItem'],
  setMemoryFileCount: (count: number) => void,
): DirectoryCommandOperations {
  return {
    isConfigured: runtime !== null,
    addDirectory: (path) => {
      if (!runtime) throw new Error('Directory runtime is unavailable');
      runtime.addDirectory(path);
    },
    directories: () => {
      if (!runtime) throw new Error('Directory runtime is unavailable');
      return runtime.directories();
    },
    getFolderTrust: () => {
      if (!runtime) throw new Error('Directory runtime is unavailable');
      return runtime.getFolderTrust();
    },
    isRestrictiveSandbox: () => {
      if (!runtime) throw new Error('Directory runtime is unavailable');
      return runtime.isRestrictiveSandbox();
    },
    refreshMemory: async () => {
      if (!runtime) throw new Error('Directory runtime is unavailable');
      return runtime.refreshMemory();
    },
    shouldLoadMemoryFromIncludeDirectories: () => {
      if (!runtime) throw new Error('Directory runtime is unavailable');
      return runtime.shouldLoadMemoryFromIncludeDirectories();
    },
    addItem,
    setMemoryFileCount,
    addDirectoryContext,
    recordDirectoriesChanged,
  };
}

export function bindDirectoryChangeRecording(
  recordingOwner: 'agent' | 'raw' | undefined,
  recordEvent: ((event: SessionRecordingEvent) => Promise<void>) | null,
  recordRawDirectories: ((directories: string[]) => void) | undefined,
): DirectoryCommandOperations['recordDirectoriesChanged'] {
  return async (directories) => {
    if (recordingOwner === 'agent') {
      if (recordEvent === null) throw new Error('Session agent is unavailable');
      await recordEvent({
        type: 'directories_changed',
        directories: [...directories],
      });
    } else {
      recordRawDirectories?.([...directories]);
    }
  };
}
