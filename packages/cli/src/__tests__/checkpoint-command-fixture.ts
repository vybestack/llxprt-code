/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  AgentClientContract,
  GitService,
} from '@vybestack/llxprt-code-core';
import { createRestoreCommand } from '../ui/commands/restoreCommand.js';
import type { SlashCommand } from '../ui/commands/types.js';

export function checkpointCommand(
  client: AgentClientContract,
  runtime: {
    readonly projectCheckpointsDir: string;
    getCheckpointingEnabled(): boolean;
  },
  git?: GitService,
): SlashCommand | null {
  return createRestoreCommand(
    {
      enabled: runtime.getCheckpointingEnabled(),
      checkpointDirectory: runtime.projectCheckpointsDir,
      replaceHistoryFromSource: (rows, signal) =>
        client.setHistoryFromSource(rows, { signal }),
      git,
    },
    () => true,
  );
}
