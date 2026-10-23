/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import type { LoadedSettings } from '../../config/settings.js';
import type { BuiltinCommandOwners } from '../../services/BuiltinCommandLoader.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import {
  createSkillsCommand,
  type SkillsCommandOperations,
} from '../commands/skillsCommand.js';
import { bindSkillsCommand } from '../commands/skillsCommandHost.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';

export function useResourceCommands(
  config: CliUiRuntime | null,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
  setPendingItem: SkillsCommandOperations['setPendingItem'],
): Pick<BuiltinCommandOwners, 'skillsCommand'> {
  const skillsCommand = useMemo(
    () =>
      createSkillsCommand(
        bindSkillsCommand(
          config?.skillOperations,
          config !== null,
          settings,
          addItem,
          setPendingItem,
        ),
      ),
    [config, settings, addItem, setPendingItem],
  );
  return useMemo(() => ({ skillsCommand }), [skillsCommand]);
}
