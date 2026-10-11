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
import {
  type HookRegistryEntry,
  type HookEventName,
  HookType,
  ConfigSource,
} from '@vybestack/llxprt-code-core';
import type { HookInfo } from '@vybestack/llxprt-code-agents';

/**
 * Map projected HookInfo[] from the agent surface to the richer
 * HookRegistryEntry[] shape expected by the HooksList display component.
 * The HookInfo projection intentionally omits command/type details (the
 * Agent API surface does not expose them); config.command is left empty so
 * HooksList shows the hook name without a stale command line. This is
 * tracked migration debt — see #1595 for extending the projection.
 */
function mapHookInfoToEntries(hooks: readonly HookInfo[]): HookRegistryEntry[] {
  return hooks.map((h) => ({
    config: {
      type: HookType.Command,
      command: '',
      name: h.name,
    },
    source: (h.source ?? ConfigSource.User) as ConfigSource,
    eventName: h.eventName as HookEventName,
    enabled: h.enabled,
  }));
}

/**
 * List all registered hooks
 */
async function listHooks(context: CommandContext): Promise<void> {
  const agent = context.services.agent;

  if (agent) {
    const agentHooks = agent.hooks.listHooks();
    if (agentHooks.length === 0) {
      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: 'No hooks registered.',
        },
        Date.now(),
      );
      return;
    }
    const historyItem: HistoryItemHooksList = {
      type: MessageType.HOOKS_LIST,
      hooks: mapHookInfoToEntries(agentHooks),
    };
    context.ui.addItem(historyItem);
    return;
  }

  const { config } = context.services;
  if (!config) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Configuration not loaded.',
      },
      Date.now(),
    );
    return;
  }

  context.ui.addItem(
    {
      type: MessageType.INFO,
      text: 'Hook execution requires an active Agent. Enable hooks in settings with hooksConfig.enabled.',
    },
    Date.now(),
  );
}

/**
 * Check whether a hook with the given name is registered on the Agent surface.
 * Emits an error message via context.ui if not found.
 * Returns true if the hook exists, false otherwise.
 */
function resolveAgentHook(
  agent: NonNullable<CommandContext['services']['agent']>,
  hookName: string,
  context: CommandContext,
): boolean {
  const allHooks = agent.hooks.listHooks();
  const found = allHooks.some((h) => h.name === hookName);
  if (!found) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: `Hook '${hookName}' not found.`,
      },
      Date.now(),
    );
    return false;
  }
  return true;
}

/**
 * Enable a hook by name
 */
async function enableHook(
  context: CommandContext,
  hookName: string,
): Promise<void> {
  const { config } = context.services;
  const agent = context.services.agent;

  if (agent) {
    if (!resolveAgentHook(agent, hookName, context)) {
      return;
    }
    agent.hooks.enable(hookName);
    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: `Enabled hook '${hookName}'.`,
      },
      Date.now(),
    );
    return;
  }

  if (!config) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Configuration not loaded.',
      },
      Date.now(),
    );
    return;
  }

  context.ui.addItem(
    {
      type: MessageType.INFO,
      text: 'Hook execution requires an active Agent. Enable hooks in settings with hooksConfig.enabled.',
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
  const agent = context.services.agent;

  if (agent) {
    if (!resolveAgentHook(agent, hookName, context)) {
      return;
    }
    agent.hooks.disable(hookName);
    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: `Disabled hook '${hookName}'.`,
      },
      Date.now(),
    );
    return;
  }

  if (!config) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Configuration not loaded.',
      },
      Date.now(),
    );
    return;
  }

  context.ui.addItem(
    {
      type: MessageType.INFO,
      text: 'Hook execution requires an active Agent. Enable hooks in settings with hooksConfig.enabled.',
    },
    Date.now(),
  );
}

/**
 * Enable all hooks
 */
async function enableAllHooks(context: CommandContext): Promise<void> {
  const { config } = context.services;
  const agent = context.services.agent;

  if (agent) {
    const allHooks = agent.hooks.listHooks();
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
    agent.hooks.setDisabledHooks([]);
    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: `Enabled all ${allHooks.length} hook(s).`,
      },
      Date.now(),
    );
    await listHooks(context);
    return;
  }

  if (!config) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Configuration not loaded.',
      },
      Date.now(),
    );
    return;
  }

  context.ui.addItem(
    {
      type: MessageType.INFO,
      text: 'Hook execution requires an active Agent. Enable hooks in settings with hooksConfig.enabled.',
    },
    Date.now(),
  );
}

/**
 * Disable all hooks
 */
async function disableAllHooks(context: CommandContext): Promise<void> {
  const { config } = context.services;
  const agent = context.services.agent;

  if (agent) {
    const allHooks = agent.hooks.listHooks();
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
    const allHookNames = allHooks.map((h) => h.name);
    agent.hooks.setDisabledHooks(allHookNames);
    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: `Disabled all ${allHooks.length} hook(s).`,
      },
      Date.now(),
    );
    await listHooks(context);
    return;
  }

  if (!config) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Configuration not loaded.',
      },
      Date.now(),
    );
    return;
  }

  context.ui.addItem(
    {
      type: MessageType.INFO,
      text: 'Hook execution requires an active Agent. Enable hooks in settings with hooksConfig.enabled.',
    },
    Date.now(),
  );
}

async function completeHookNames(
  context: CommandContext,
  partialArg: string,
): Promise<string[]> {
  return (
    context.services.agent?.hooks
      .listHooks()
      .map((hook) => hook.name)
      .filter((name) => name.startsWith(partialArg)) ?? []
  );
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
