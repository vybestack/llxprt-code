/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import type { LoadedSettings } from '../../config/settings.js';
import type { BuiltinCommandOwners } from '../../services/BuiltinCommandLoader.js';
import type { WorkspaceSkillOperations } from '@vybestack/llxprt-code-core';
import {
  createSkillsCommand,
  type SkillsCommandOperations,
} from '../commands/skillsCommand.js';
import { bindSkillsCommand } from '../commands/skillsCommandHost.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';

/**
 * The skill operations /skills needs; undefined when the workspace exposes no
 * skill manager.
 */
export type SkillsCommandRuntime = Pick<
  WorkspaceSkillOperations,
  'list' | 'find' | 'isAdminEnabled' | 'reload'
>;

export function useResourceCommands(
  skills: SkillsCommandRuntime | undefined,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
  setPendingItem: SkillsCommandOperations['setPendingItem'],
): Pick<BuiltinCommandOwners, 'skillsCommand'> {
  const skillsCommand = useMemo(
    () =>
      createSkillsCommand(
        bindSkillsCommand(
          skills,
          skills !== undefined,
          settings,
          addItem,
          setPendingItem,
        ),
      ),
    [skills, settings, addItem, setPendingItem],
  );
  return useMemo(() => ({ skillsCommand }), [skillsCommand]);
}
