/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../../config/settings.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { SlashCommand } from '../commands/types.js';
import { createSubagentCommand } from '../commands/subagentCommand.js';
import {
  bindSubagentCommand,
  bindAutoPromptOperation,
} from '../commands/subagentCommandHost.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';

export function useSubagentCommand(
  agent: Agent | null,
  config: CliUiRuntime | null,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
): SlashCommand {
  return useMemo(
    () =>
      createSubagentCommand(
        bindSubagentCommand(
          agent?.workspace.subagentDefinitions,
          agent?.workspace.subagentWrites,
          async () => agent?.workspace.profileDefinitions.listProfiles() ?? [],
          () => settings.merged.enableFuzzyFiltering !== false,
          bindAutoPromptOperation(agent, config),
          config !== null,
          addItem,
        ),
      ),
    [agent, config, settings, addItem],
  );
}
