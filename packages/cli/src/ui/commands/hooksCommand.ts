/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type SlashCommand, CommandKind } from './types.js';
import {
  MessageType,
  type HistoryItemHooksList,
  type HistoryItemWithoutId,
} from '../types.js';
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

export interface HooksCommandOperations {
  readonly isConfigured: boolean;
  readonly isAvailable: boolean;
  readonly listHooks: () => readonly HookInfo[];
  readonly enable: (name: string) => void;
  readonly disable: (name: string) => void;
  readonly setDisabledHooks: (names: readonly string[]) => void;
}

type AddHookItem = (item: HistoryItemWithoutId, timestamp?: number) => void;

function requireHookOwner(
  operations: HooksCommandOperations,
  addItem: AddHookItem,
): boolean {
  if (operations.isAvailable) return true;
  addItem(
    operations.isConfigured
      ? {
          type: MessageType.INFO,
          text: 'Hook execution requires an active Agent. Enable hooks in settings with hooksConfig.enabled.',
        }
      : { type: MessageType.ERROR, text: 'Configuration not loaded.' },
    Date.now(),
  );
  return false;
}

function listHooks(
  operations: HooksCommandOperations,
  addItem: AddHookItem,
): void {
  if (!requireHookOwner(operations, addItem)) return;
  const hooks = operations.listHooks();
  if (hooks.length === 0) {
    addItem(
      { type: MessageType.INFO, text: 'No hooks registered.' },
      Date.now(),
    );
    return;
  }
  const item: HistoryItemHooksList = {
    type: MessageType.HOOKS_LIST,
    hooks: mapHookInfoToEntries(hooks),
  };
  addItem(item);
}

function createNamedHookCommand(
  operations: HooksCommandOperations,
  addItem: AddHookItem,
  name: 'enable' | 'disable',
): SlashCommand {
  return {
    name,
    description: `${name === 'enable' ? 'Enable' : 'Disable'} a hook by name`,
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async (_invocation, args): Promise<void> => {
      const hookName = args.trim();
      if (!hookName) {
        addItem(
          {
            type: MessageType.ERROR,
            text: `Usage: /hooks ${name} <hook-name>`,
          },
          Date.now(),
        );
        return;
      }
      if (!requireHookOwner(operations, addItem)) return;
      if (!operations.listHooks().some((hook) => hook.name === hookName)) {
        addItem(
          { type: MessageType.ERROR, text: `Hook '${hookName}' not found.` },
          Date.now(),
        );
        return;
      }
      if (name === 'enable') operations.enable(hookName);
      else operations.disable(hookName);
      addItem(
        {
          type: MessageType.INFO,
          text: `${name === 'enable' ? 'Enabled' : 'Disabled'} hook '${hookName}'.`,
        },
        Date.now(),
      );
    },
    completion: async (_invocation, partialArg): Promise<string[]> =>
      operations
        .listHooks()
        .map((hook) => hook.name)
        .filter((hook) => hook.startsWith(partialArg)),
  };
}

function createAllHooksCommand(
  operations: HooksCommandOperations,
  addItem: AddHookItem,
  enable: boolean,
): SlashCommand {
  return {
    name: enable ? 'enable-all' : 'disable-all',
    description: `${enable ? 'Enable' : 'Disable'} all registered hooks`,
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async (): Promise<void> => {
      if (!requireHookOwner(operations, addItem)) return;
      const hooks = operations.listHooks();
      if (hooks.length === 0) {
        addItem(
          { type: MessageType.INFO, text: 'No hooks registered.' },
          Date.now(),
        );
        return;
      }
      operations.setDisabledHooks(enable ? [] : hooks.map((hook) => hook.name));
      addItem(
        {
          type: MessageType.INFO,
          text: `${enable ? 'Enabled' : 'Disabled'} all ${hooks.length} hook(s).`,
        },
        Date.now(),
      );
      listHooks(operations, addItem);
    },
  };
}

export function createHooksCommand(
  operations: HooksCommandOperations,
  addItem: AddHookItem,
): SlashCommand {
  const subCommands: SlashCommand[] = [
    {
      name: 'list',
      description: 'List all registered hooks',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: async (): Promise<void> => listHooks(operations, addItem),
    },
    createNamedHookCommand(operations, addItem, 'enable'),
    createNamedHookCommand(operations, addItem, 'disable'),
    createAllHooksCommand(operations, addItem, true),
    createAllHooksCommand(operations, addItem, false),
  ];
  return {
    name: 'hooks',
    description: 'View, enable, or disable hooks',
    kind: CommandKind.BUILT_IN,
    subCommands,
    action: async (invocation, args): Promise<void> => {
      const [name, ...rest] = args.trim().split(/\s+/);
      const subCommand = subCommands.find((entry) => entry.name === name);
      if (subCommand?.action)
        await subCommand.action(invocation, rest.join(' '));
      else listHooks(operations, addItem);
    },
  };
}
