/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceCheckpointOperations } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { SlashCommand } from './types.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import { createRestoreCommand } from './restoreCommand.js';

/**
 * The checkpoint state /restore reads: whether checkpointing is on and where
 * checkpoints live.
 */
export interface RestoreCommandRuntime {
  getCheckpointingEnabled(): boolean;
  readonly projectCheckpointsDir: string;
}

export function bindRestoreCommand(
  runtime: RestoreCommandRuntime | null,
  setClientHistory: Agent['setHistory'],
  git:
    | Pick<WorkspaceCheckpointOperations, 'restoreProjectFromSnapshot'>
    | undefined,
  readFuzzyFiltering: () => boolean,
  loadHistory: UseHistoryManagerReturn['loadHistory'],
  addItem: UseHistoryManagerReturn['addItem'],
): SlashCommand | null {
  return createRestoreCommand(
    {
      enabled: runtime?.getCheckpointingEnabled() === true,
      checkpointDirectory: runtime?.projectCheckpointsDir,
      setClientHistory,
      restoreProjectSnapshot: git
        ? (commitHash) => git.restoreProjectFromSnapshot(commitHash)
        : undefined,
    },
    readFuzzyFiltering,
    loadHistory,
    addItem,
  );
}
