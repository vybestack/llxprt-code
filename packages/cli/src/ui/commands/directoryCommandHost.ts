/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SessionRecordingEvent } from '@vybestack/llxprt-code-agents';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { DirectoryCommandOperations } from './directoryCommand.js';

export function bindDirectoryCommand(
  config: CliUiRuntime | null,
  addDirectoryContext: DirectoryCommandOperations['addDirectoryContext'],
  recordDirectoriesChanged: DirectoryCommandOperations['recordDirectoriesChanged'],
  addItem: UseHistoryManagerReturn['addItem'],
  setMemoryFileCount: (count: number) => void,
): DirectoryCommandOperations {
  return {
    isConfigured: config !== null,
    addDirectory: (path) => {
      if (!config) throw new Error('Directory runtime is unavailable');
      config.addDirectory(path);
    },
    directories: () => {
      if (!config) throw new Error('Directory runtime is unavailable');
      return config.directories();
    },
    getFolderTrust: () => {
      if (!config) throw new Error('Directory runtime is unavailable');
      return config.getFolderTrust();
    },
    isRestrictiveSandbox: () => {
      if (!config) throw new Error('Directory runtime is unavailable');
      return config.isRestrictiveSandbox();
    },
    refreshMemory: async () => {
      if (!config) throw new Error('Directory runtime is unavailable');
      return config.refreshMemory();
    },
    shouldLoadMemoryFromIncludeDirectories: () => {
      if (!config) throw new Error('Directory runtime is unavailable');
      return config.shouldLoadMemoryFromIncludeDirectories();
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
