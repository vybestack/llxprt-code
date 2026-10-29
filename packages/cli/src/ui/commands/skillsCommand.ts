/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type SlashCommand,
  type SlashCommandActionReturn,
  CommandKind,
} from './types.js';
import {
  type HistoryItemWithoutId,
  MessageType,
  type HistoryItemSkillsList,
  type HistoryItemInfo,
} from '../types.js';

import type { disableSkill } from '../../utils/skillSettings.js';
import type { SkillDefinition } from '@vybestack/llxprt-code-core';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
export interface SkillsCommandOperations {
  readonly isConfigured: boolean;
  readonly isAvailable: boolean;
  readonly list: (includeDisabled?: boolean) => SkillDefinition[];
  readonly find: (name: string) => SkillDefinition | undefined;
  readonly isAdminEnabled: () => boolean;
  readonly enable: (name: string) => ReturnType<typeof disableSkill>;
  readonly disable: (name: string) => ReturnType<typeof disableSkill>;
  readonly reload: () => Promise<void>;
  readonly addItem: UseHistoryManagerReturn['addItem'];
  readonly setPendingItem: (item: HistoryItemWithoutId | null) => void;
}
import { renderSkillActionFeedback } from '../../utils/skillUtils.js';

async function listAction(
  context: SkillsCommandOperations,
  args: string,
): Promise<void | SlashCommandActionReturn> {
  const subCommand = args.trim().toLowerCase();

  // Parse arguments: 'nodesc', 'all', or both
  const parts = subCommand.split(/\s+/).filter((p) => p.length > 0);
  let useShowDescriptions = true;
  let showAll = false;

  for (const part of parts) {
    if (part === 'nodesc') {
      useShowDescriptions = false;
    } else if (part === 'all') {
      showAll = true;
    }
  }

  const skillManager = context.isAvailable ? context : null;
  if (!skillManager) {
    context.addItem(
      {
        type: MessageType.ERROR,
        text: 'Could not retrieve skill manager.',
      },
      Date.now(),
    );
    return;
  }

  let skills = skillManager.list(true);

  // By default, filter out built-in skills unless 'all' is specified
  if (!showAll) {
    skills = skills.filter((skill) => skill.source !== 'builtin');
  }

  const skillsListItem: HistoryItemSkillsList = {
    type: MessageType.SKILLS_LIST,
    skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      disabled: skill.disabled,
      location: skill.location,
      body: skill.body,
      source: skill.source,
    })),
    showDescriptions: useShowDescriptions,
  };

  context.addItem(skillsListItem);
}

async function disableAction(
  context: SkillsCommandOperations,
  args: string,
): Promise<void | SlashCommandActionReturn> {
  const skillName = args.trim();
  if (!skillName) {
    context.addItem(
      {
        type: MessageType.ERROR,
        text: 'Please provide a skill name to disable.',
      },
      Date.now(),
    );
    return;
  }
  const skillManager = context.isAvailable ? context : null;
  if (skillManager?.isAdminEnabled() === false) {
    context.addItem(
      {
        type: MessageType.ERROR,
        text: 'Skills are disabled by your admin.',
      },
      Date.now(),
    );
    return;
  }

  const skill = skillManager?.find(skillName);
  if (!skill) {
    context.addItem(
      {
        type: MessageType.ERROR,
        text: `Skill "${skillName}" not found.`,
      },
      Date.now(),
    );
    return;
  }

  const result = context.disable(skillName);

  let feedback = renderSkillActionFeedback(
    result,
    (label, path) => `${label} (${path})`,
  );
  if (result.status === 'success') {
    feedback += ' Use "/skills reload" for it to take effect.';
  }

  context.addItem(
    {
      type: MessageType.INFO,
      text: feedback,
    },
    Date.now(),
  );
}

async function enableAction(
  context: SkillsCommandOperations,
  args: string,
): Promise<void | SlashCommandActionReturn> {
  const skillName = args.trim();
  if (!skillName) {
    context.addItem(
      {
        type: MessageType.ERROR,
        text: 'Please provide a skill name to enable.',
      },
      Date.now(),
    );
    return;
  }

  const skillManager = context.isAvailable ? context : null;
  if (skillManager?.isAdminEnabled() === false) {
    context.addItem(
      {
        type: MessageType.ERROR,
        text: 'Skills are disabled by your admin.',
      },
      Date.now(),
    );
    return;
  }

  const result = context.enable(skillName);

  let feedback = renderSkillActionFeedback(
    result,
    (label, path) => `${label} (${path})`,
  );
  if (result.status === 'success') {
    feedback += ' Use "/skills reload" for it to take effect.';
  }

  context.addItem(
    {
      type: MessageType.INFO,
      text: feedback,
    },
    Date.now(),
  );
}

function buildReloadSummary(
  beforeNames: Set<string>,
  afterSkills: Array<{ name: string }>,
): string {
  const afterNames = new Set(afterSkills.map((s) => s.name));
  const added = afterSkills.filter((s) => !beforeNames.has(s.name));
  const removedCount = [...beforeNames].filter(
    (name) => !afterNames.has(name),
  ).length;

  let successText = 'Skills reloaded successfully.';
  const details: string[] = [];

  if (added.length > 0) {
    details.push(
      `${added.length} newly available skill${added.length > 1 ? 's' : ''}`,
    );
  }
  if (removedCount > 0) {
    details.push(
      `${removedCount} skill${removedCount > 1 ? 's' : ''} no longer available`,
    );
  }

  if (details.length > 0) {
    successText += ` ${details.join(' and ')}.`;
  }
  return successText;
}

async function reloadAction(
  context: SkillsCommandOperations,
): Promise<void | SlashCommandActionReturn> {
  if (!context.isConfigured) {
    context.addItem(
      {
        type: MessageType.ERROR,
        text: 'Could not retrieve configuration.',
      },
      Date.now(),
    );
    return;
  }

  const skillManager = context.isAvailable ? context : null;
  if (!skillManager) throw new Error('Skills reload requires a session owner');
  const beforeNames = new Set(skillManager.list().map((s) => s.name));

  const startTime = Date.now();
  const pendingState = { itemSet: false };
  const pendingTimeout = setTimeout(() => {
    context.setPendingItem({
      type: MessageType.INFO,
      text: 'Reloading skills...',
    });
    pendingState.itemSet = true;
  }, 100);

  try {
    await skillManager.reload();

    clearTimeout(pendingTimeout);
    if (pendingState.itemSet) {
      const elapsed = Date.now() - startTime;
      const minVisibleDuration = 500;
      if (elapsed < minVisibleDuration) {
        await new Promise((resolve) =>
          setTimeout(resolve, minVisibleDuration - elapsed),
        );
      }
      context.setPendingItem(null);
    }

    const afterSkills = skillManager.list();
    const successText = buildReloadSummary(beforeNames, afterSkills);

    context.addItem(
      {
        type: 'info',
        text: successText,
        icon: '✓ ',
        color: 'green',
      } as HistoryItemInfo,
      Date.now(),
    );
  } catch (error) {
    clearTimeout(pendingTimeout);
    if (pendingState.itemSet) {
      context.setPendingItem(null);
    }
    context.addItem(
      {
        type: MessageType.ERROR,
        text: `Failed to reload skills: ${error instanceof Error ? error.message : String(error)}`,
      },
      Date.now(),
    );
  }
}

async function disableCompletion(
  context: SkillsCommandOperations,
  partialArg: string,
): Promise<string[]> {
  const skillManager = context.isAvailable ? context : null;
  if (!skillManager) {
    return [];
  }
  return skillManager
    .list(true)
    .filter((s) => s.disabled !== true && s.name.startsWith(partialArg))
    .map((s) => s.name);
}

async function enableCompletion(
  context: SkillsCommandOperations,
  partialArg: string,
): Promise<string[]> {
  const skillManager = context.isAvailable ? context : null;
  if (!skillManager) {
    return [];
  }
  return skillManager
    .list(true)
    .filter((s) => s.disabled === true && s.name.startsWith(partialArg))
    .map((s) => s.name);
}

export function createSkillsCommand(
  operations: SkillsCommandOperations,
): SlashCommand {
  return {
    name: 'skills',
    description:
      'List, enable, disable, or reload LLxprt Code skills. Usage: /skills [list | disable <name> | enable <name> | reload]',
    kind: CommandKind.BUILT_IN,
    autoExecute: false,
    subCommands: [
      {
        name: 'list',
        description:
          'List available agent skills. Usage: /skills list [all] [nodesc]',
        kind: CommandKind.BUILT_IN,
        action: async (_invocation, args) => listAction(operations, args),
      },
      {
        name: 'disable',
        description: 'Disable a skill by name. Usage: /skills disable <name>',
        kind: CommandKind.BUILT_IN,
        action: async (_invocation, args) => disableAction(operations, args),
        completion: async (_invocation, args) =>
          disableCompletion(operations, args),
      },
      {
        name: 'enable',
        description:
          'Enable a disabled skill by name. Usage: /skills enable <name>',
        kind: CommandKind.BUILT_IN,
        action: async (_invocation, args) => enableAction(operations, args),
        completion: async (_invocation, args) =>
          enableCompletion(operations, args),
      },
      {
        name: 'reload',
        description:
          'Reload the list of discovered skills. Usage: /skills reload',
        kind: CommandKind.BUILT_IN,
        action: async () => reloadAction(operations),
      },
    ],
    action: async (_invocation, args) => listAction(operations, args),
  };
}
