/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceCheckpointOperations } from '@vybestack/llxprt-code-core';

import type { SlashCommand } from './types.js';
import {
  type RestoreCommandOperations,
  createRestoreCommand,
} from './restoreCommand.js';

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
  replaceHistoryFromSource: RestoreCommandOperations['replaceHistoryFromSource'],
  git:
    | Pick<
        WorkspaceCheckpointOperations,
        | 'createFileSnapshot'
        | 'getCurrentCommitHash'
        | 'restoreProjectFromSnapshot'
      >
    | undefined,
  readFuzzyFiltering: () => boolean,
): SlashCommand | null {
  return createRestoreCommand(
    {
      enabled: runtime?.getCheckpointingEnabled() === true,
      checkpointDirectory: runtime?.projectCheckpointsDir,
      replaceHistoryFromSource,
      git,
    },
    readFuzzyFiltering,
  );
}
