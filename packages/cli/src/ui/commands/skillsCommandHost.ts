/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LoadedSettings } from '../../config/settings.js';
import { SettingScope } from '../../config/settings.js';
import { disableSkill, enableSkill } from '../../utils/skillSettings.js';
import type { WorkspaceSkillOperations } from '@vybestack/llxprt-code-core';
import type { SkillsCommandOperations } from './skillsCommand.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
export function bindSkillsCommand(
  skills:
    | Pick<
        WorkspaceSkillOperations,
        'list' | 'find' | 'isAdminEnabled' | 'reload'
      >
    | undefined,
  isConfigured: boolean,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
  setPendingItem: SkillsCommandOperations['setPendingItem'],
): SkillsCommandOperations {
  return {
    isConfigured,
    isAvailable: skills !== undefined,
    list: (includeDisabled) => skills?.list(includeDisabled) ?? [],
    find: (name) => skills?.find(name),
    isAdminEnabled: () => skills?.isAdminEnabled() ?? false,
    enable: (name) => enableSkill(settings, name),
    disable: (name) =>
      disableSkill(
        settings,
        name,
        settings.workspace.path ? SettingScope.Workspace : SettingScope.User,
      ),
    reload: async () => {
      if (!skills) throw new Error('Skill manager unavailable');
      await skills.reload();
    },
    addItem,
    setPendingItem,
  };
}
