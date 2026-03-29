/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type CommandContext,
  type SlashCommand,
  CommandKind,
} from './types.js';
import { MessageType, type HistoryItemHooksList } from '../types.js';
import { type HookRegistryEntry } from '@vybestack/llxprt-code-core';

/**
 * List all registered hooks
 */
async function listHooks(context: CommandContext): Promise<void> {
  const { config } = context.services;
  if (!config) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Config not loaded.',
      },
      Date.now(),
    );
    return;
  }

  const hookSystem = config.getHookSystem();
  if (!hookSystem) {
    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: 'Hooks system is not enabled. Enable it in settings with hooks.enabled.',
      },
      Date.now(),
    );
    return;
  }

  await hookSystem.initialize();
  const hookRegistry = hookSystem.getRegistry();
  const allHooks = hookRegistry.getAllHooks();

  const historyItem: HistoryItemHooksList = {
    type: MessageType.HOOKS_LIST,
    hooks: allHooks,
  };

  context.ui.addItem(historyItem);
}

/**
 * Enable a hook by name
 */
async function enableHook(
  context: CommandContext,
  hookName: string,
): Promise<void> {
  const { config } = context.services;
  if (!config) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Config not loaded.',
      },
      Date.now(),
    );
    return;
  }

  const hookSystem = config.getHookSystem();
  if (!hookSystem) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Hooks system is not enabled.',
      },
      Date.now(),
    );
    return;
  }

  await hookSystem.initialize();
  const hookRegistry = hookSystem.getRegistry();

  // Find the hook
  const allHooks = hookRegistry.getAllHooks();
  const matchingHook = allHooks.find(
    (entry) => hookRegistry.getHookName(entry) === hookName,
  );

  if (!matchingHook) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: `Hook '${hookName}' not found.`,
      },
      Date.now(),
    );
    return;
  }

  // Remove from disabled list
  const disabledHooks = config.getDisabledHooks();
  const newDisabledHooks = disabledHooks.filter(
    (name: string) => name !== hookName,
  );
  config.setDisabledHooks(newDisabledHooks);

  // Update the registry
  hookRegistry.setHookEnabled(hookName, true);

  context.ui.addItem(
    {
      type: MessageType.INFO,
      text: `Enabled hook '${hookName}'.`,
    },
    Date.now(),
  );
}

/**
 * Disable a hook by name
 */
async function disableHook(
  context: CommandContext,
  hookName: string,
): Promise<void> {
  const { config } = context.services;
  if (!config) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Config not loaded.',
      },
      Date.now(),
    );
    return;
  }

  const hookSystem = config.getHookSystem();
  if (!hookSystem) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Hooks system is not enabled.',
      },
      Date.now(),
    );
    return;
  }

  await hookSystem.initialize();
  const hookRegistry = hookSystem.getRegistry();

  // Find the hook
  const allHooks = hookRegistry.getAllHooks();
  const matchingHook = allHooks.find(
    (entry: HookRegistryEntry) => hookRegistry.getHookName(entry) === hookName,
  );

  if (!matchingHook) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: `Hook '${hookName}' not found.`,
      },
      Date.now(),
    );
    return;
  }

  // Add to disabled list
  const disabledHooks = config.getDisabledHooks();
  if (!disabledHooks.includes(hookName)) {
    const newDisabledHooks = [...disabledHooks, hookName];
    config.setDisabledHooks(newDisabledHooks);
  }

  // Update the registry
  hookRegistry.setHookEnabled(hookName, false);

  context.ui.addItem(
    {
      type: MessageType.INFO,
      text: `Disabled hook '${hookName}'.`,
    },
    Date.now(),
  );
}

/**
 * Enable all hooks
 */
async function enableAllHooks(context: CommandContext): Promise<void> {
  const { config } = context.services;
  if (!config) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Config not loaded.',
      },
      Date.now(),
    );
    return;
  }

  const hookSystem = config.getHookSystem();
  if (!hookSystem) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Hooks system is not enabled.',
      },
      Date.now(),
    );
    return;
  }

  await hookSystem.initialize();
  const hookRegistry = hookSystem.getRegistry();
  const allHooks = hookRegistry.getAllHooks();

  if (allHooks.length === 0) {
    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: 'No hooks registered.',
      },
      Date.now(),
    );
    return;
  }

  // Clear disabled hooks list
  config.setDisabledHooks([]);

  // Enable all hooks in registry
  for (const hook of allHooks) {
    const hookName = hookRegistry.getHookName(hook);
    hookRegistry.setHookEnabled(hookName, true);
  }

  context.ui.addItem(
    {
      type: MessageType.INFO,
      text: `Enabled all ${allHooks.length} hook(s).`,
    },
    Date.now(),
  );

  // Show updated list
  const historyItem: HistoryItemHooksList = {
    type: MessageType.HOOKS_LIST,
    hooks: allHooks,
  };
  context.ui.addItem(historyItem);
}

/**
 * Disable all hooks
 */
async function disableAllHooks(context: CommandContext): Promise<void> {
  const { config } = context.services;
  if (!config) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Config not loaded.',
      },
      Date.now(),
    );
    return;
  }

  const hookSystem = config.getHookSystem();
  if (!hookSystem) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Hooks system is not enabled.',
      },
      Date.now(),
    );
    return;
  }

  await hookSystem.initialize();
  const hookRegistry = hookSystem.getRegistry();
  const allHooks = hookRegistry.getAllHooks();

  if (allHooks.length === 0) {
    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: 'No hooks registered.',
      },
      Date.now(),
    );
    return;
  }

  // Build list of all hook names
  const allHookNames = allHooks.map((hook) => hookRegistry.getHookName(hook));

  // Set all hooks as disabled in config
  config.setDisabledHooks(allHookNames);

  // Disable all hooks in registry
  for (const hookName of allHookNames) {
    hookRegistry.setHookEnabled(hookName, false);
  }

  context.ui.addItem(
    {
      type: MessageType.INFO,
      text: `Disabled all ${allHooks.length} hook(s).`,
    },
    Date.now(),
  );

  // Show updated list
  const historyItem: HistoryItemHooksList = {
    type: MessageType.HOOKS_LIST,
    hooks: allHooks,
  };
  context.ui.addItem(historyItem);
}

async function completeHookNames(
  context: CommandContext,
  partialArg: string,
): Promise<string[]> {
  const { config } = context.services;
  if (!config) {
    return [];
  }

  const hookSystem = config.getHookSystem();
  if (!hookSystem) {
    return [];
  }

  await hookSystem.initialize();
  const hookRegistry = hookSystem.getRegistry();
  const hookNames = hookRegistry
    .getAllHooks()
    .map((entry) => hookRegistry.getHookName(entry));
  return hookNames.filter((name) => name.startsWith(partialArg));
}

const listCommand: SlashCommand = {
  name: 'list',
  description: 'List all registered hooks',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context: CommandContext) => {
    await listHooks(context);
  },
};

const enableCommand: SlashCommand = {
  name: 'enable',
  description: 'Enable a hook by name',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context: CommandContext, args: string) => {
    const hookName = args.trim();
    if (!hookName) {
      context.ui.addItem(
        {
          type: MessageType.ERROR,
          text: 'Usage: /hooks enable <hook-name>',
        },
        Date.now(),
      );
      return;
    }
    await enableHook(context, hookName);
  },
  completion: completeHookNames,
};

const disableCommand: SlashCommand = {
  name: 'disable',
  description: 'Disable a hook by name',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context: CommandContext, args: string) => {
    const hookName = args.trim();
    if (!hookName) {
      context.ui.addItem(
        {
          type: MessageType.ERROR,
          text: 'Usage: /hooks disable <hook-name>',
        },
        Date.now(),
      );
      return;
    }
    await disableHook(context, hookName);
  },
  completion: completeHookNames,
};

const enableAllCommand: SlashCommand = {
  name: 'enable-all',
  description: 'Enable all registered hooks',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context: CommandContext) => {
    await enableAllHooks(context);
  },
};

const disableAllCommand: SlashCommand = {
  name: 'disable-all',
  description: 'Disable all registered hooks',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context: CommandContext) => {
    await disableAllHooks(context);
  },
};

export const hooksCommand: SlashCommand = {
  name: 'hooks',
  description: 'View, enable, or disable hooks',
  kind: CommandKind.BUILT_IN,
  subCommands: [
    listCommand,
    enableCommand,
    disableCommand,
    enableAllCommand,
    disableAllCommand,
  ],
  action: async (context: CommandContext, args: string) => {
    // Default action when no subcommand is provided - show the list
    if (!args || args.trim() === '') {
      await listHooks(context);
    } else {
      // Try to parse as a subcommand
      const tokens = args.trim().split(/\s+/);
      const subCommandName = tokens[0];
      const subArgs = tokens.slice(1).join(' ');

      const subCommand = [
        listCommand,
        enableCommand,
        disableCommand,
        enableAllCommand,
        disableAllCommand,
      ].find((cmd) => cmd.name === subCommandName);

      if (subCommand?.action) {
        await subCommand.action(context, subArgs);
      } else {
        await listHooks(context);
      }
    }
  },
};
