/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';
import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { DirectoryCommandOperations } from './directoryCommand.js';

export function bindDirectoryCommand(
  config: CliUiRuntime | null,
  agent: Agent | null,
  recordingOwner: 'agent' | 'raw' | undefined,
  recordingIntegration: RecordingIntegration | undefined,
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
    addDirectoryContext: async () => {
      if (!agent) throw new Error('Session agent is unavailable');
      await agent.agentClient.addDirectoryContext();
    },
    recordDirectoriesChanged: async (directories) => {
      if (recordingOwner === 'agent') {
        if (!agent) throw new Error('Session agent is unavailable');
        await agent.session.recordRecordingEvent({
          type: 'directories_changed',
          directories: [...directories],
        });
      } else {
        recordingIntegration?.recordDirectoriesChanged([...directories]);
      }
    },
  };
}
