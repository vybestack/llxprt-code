/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import type { SlashCommand } from '../commands/types.js';
import { createSubagentCommand } from '../commands/subagentCommand.js';
import { bindSubagentCommand } from '../commands/subagentCommandHost.js';

export function useSubagentCommand(
  reads: Parameters<typeof bindSubagentCommand>[0],
  writes: Parameters<typeof bindSubagentCommand>[1],
  listProfiles: Parameters<typeof bindSubagentCommand>[2],
  isFuzzyEnabled: Parameters<typeof bindSubagentCommand>[3],
  generatePrompt: Parameters<typeof bindSubagentCommand>[4],
  isConfigured: boolean,
  addItem: Parameters<typeof bindSubagentCommand>[6],
): SlashCommand {
  return useMemo(
    () =>
      createSubagentCommand(
        bindSubagentCommand(
          reads,
          writes,
          listProfiles,
          isFuzzyEnabled,
          generatePrompt,
          isConfigured,
          addItem,
        ),
      ),
    [
      reads,
      writes,
      listProfiles,
      isFuzzyEnabled,
      generatePrompt,
      isConfigured,
      addItem,
    ],
  );
}
