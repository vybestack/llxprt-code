/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';
import type { WorkspaceCheckpointOperations } from '@vybestack/llxprt-code-core';
import type { SlashCommand } from './types.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import { createRestoreCommand } from './restoreCommand.js';

export function bindRestoreCommand(
  config: CliUiRuntime | null,
  agent: Agent | null,
  git:
    | Pick<WorkspaceCheckpointOperations, 'restoreProjectFromSnapshot'>
    | undefined,
  readFuzzyFiltering: () => boolean,
  loadHistory: UseHistoryManagerReturn['loadHistory'],
  addItem: UseHistoryManagerReturn['addItem'],
): SlashCommand | null {
  return createRestoreCommand(
    {
      enabled: config?.getCheckpointingEnabled() === true,
      checkpointDirectory: config?.projectCheckpointsDir,
      setClientHistory: (history) => {
        if (!agent) throw new Error('Session agent is unavailable');
        return agent.setHistory(history);
      },
      restoreProjectSnapshot: git
        ? (commitHash) => git.restoreProjectFromSnapshot(commitHash)
        : undefined,
    },
    readFuzzyFiltering,
    loadHistory,
    addItem,
  );
}
