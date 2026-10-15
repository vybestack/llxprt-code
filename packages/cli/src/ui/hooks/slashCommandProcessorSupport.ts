/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useShallowMemo } from './useShallowMemo.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import process from 'node:process';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { type Todo, CoreEvent, coreEvents } from '@vybestack/llxprt-code-core';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { Message, HistoryItemWithoutId } from '../types.js';
import { MessageType } from '../types.js';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import { CommandService } from '../../services/CommandService.js';
import {
  BuiltinCommandLoader,
  type BuiltinCommandOwners,
} from '../../services/BuiltinCommandLoader.js';
import { bindShellPromptOperations } from '../../services/prompt-processors/shellPromptHost.js';
import { FileCommandLoader } from '../../services/FileCommandLoader.js';
import { McpPromptLoader } from '../../services/McpPromptLoader.js';
import type { ICommandLoader } from '../../services/types.js';
import type { ExtensionUpdateState } from '../state/extensions.js';
import {
  slashCommandLogger,
  type SlashCommandProcessorActions,
} from './slashCommandProcessor.js';

interface TodoContextValue {
  todos: Todo[];
  updateTodos: (todos: Todo[]) => void;
  refreshTodos: () => void;
}

interface CommandContextInputs {
  addItem: UseHistoryManagerReturn['addItem'];
  clearItems: UseHistoryManagerReturn['clearItems'];
  loadHistory: UseHistoryManagerReturn['loadHistory'];
  refreshStatic: () => void;
  toggleVimEnabled: () => Promise<boolean>;
  setLlxprtMdFileCount: (count: number) => void;
  actions: SlashCommandProcessorActions;
  alternateBuffer: boolean;
  pendingItem: HistoryItemWithoutId | null;
  setPendingItem: (item: HistoryItemWithoutId | null) => void;
  sessionShellAllowlist: Set<string>;
  localIsProcessing: boolean;
  reloadCommands: () => void;
  extensionsUpdateState: Map<string, ExtensionUpdateState>;
  todoContext: TodoContextValue | undefined;
  stats: {
    stats: CommandContext['session']['stats'];
    updateHistoryTokenCount: (count: number) => void;
  };
}

export function convertMessageToHistoryItem(
  message: Message,
): HistoryItemWithoutId {
  switch (message.type) {
    case MessageType.ABOUT:
      return {
        type: 'about',
        cliVersion: message.cliVersion,
        osVersion: message.osVersion,
        sandboxEnv: message.sandboxEnv,
        modelVersion: message.modelVersion,
        keyfile: message.keyfile || '',
        key: message.key || '',
        ideClient: message.ideClient,
        provider: message.provider || 'Unknown',
        baseURL: message.baseURL || '',
      };
    case MessageType.HELP:
      return { type: 'help', timestamp: message.timestamp };
    case MessageType.STATS:
      return { type: 'stats', duration: message.duration };
    case MessageType.MODEL_STATS:
      return { type: 'model_stats' };
    case MessageType.TOOL_STATS:
      return { type: 'tool_stats' };
    case MessageType.QUIT:
      return { type: 'quit', duration: message.duration };
    case MessageType.COMPRESSION:
      return { type: 'compression', compression: message.compression };
    case MessageType.CACHE_STATS:
      return { type: 'cache_stats' };
    case MessageType.LB_STATS:
      return { type: 'lb_stats' };
    default:
      return {
        type: message.type,
        text: message.content,
      };
  }
}

export function usePendingHistory(
  addItem: UseHistoryManagerReturn['addItem'],
): {
  pendingItem: HistoryItemWithoutId | null;
  setPendingItem: (item: HistoryItemWithoutId | null) => void;
  pendingHistoryItems: HistoryItemWithoutId[];
  addMessage: (message: Message) => void;
} {
  const [pendingItem, setPendingItem] = useState<HistoryItemWithoutId | null>(
    null,
  );
  const pendingHistoryItems = useMemo(
    () => (pendingItem != null ? [pendingItem] : []),
    [pendingItem],
  );
  const addMessage = useCallback(
    (message: Message) => {
      addItem(
        convertMessageToHistoryItem(message),
        message.timestamp.getTime(),
      );
    },
    [addItem],
  );
  return { pendingItem, setPendingItem, pendingHistoryItems, addMessage };
}

/**
 * The base context is used for completions and as the template for
 * invocations; it is never the context an action runs under, because
 * `processSlashCommand` always overrides `signal` with the controller it
 * registered for that invocation. Completions are not cancellable, so a signal
 * that never aborts is the correct value here.
 */
const NEVER_ABORTED_SIGNAL = new AbortController().signal;

export function useCommandContext(
  inputs: CommandContextInputs,
): CommandContext {
  return useShallowMemo(
    (): CommandContext => ({
      signal: NEVER_ABORTED_SIGNAL,
      ui: buildCommandContextUi(inputs),
      session: {
        stats: inputs.stats.stats,
        sessionShellAllowlist: inputs.sessionShellAllowlist,
        isProcessing: inputs.localIsProcessing,
      },
      todoContext: inputs.todoContext,
    }),
    {
      ...inputs,
      stats: inputs.stats.stats,
      updateHistoryTokenCount: inputs.stats.updateHistoryTokenCount,
    },
  );
}

function buildCommandContextUi(
  inputs: CommandContextInputs,
): CommandContext['ui'] {
  return {
    addItem: inputs.addItem,
    clear: () => {
      inputs.clearItems();
      if (!inputs.alternateBuffer) {
        globalThis.console.clear();
      }
      inputs.refreshStatic();
    },
    loadHistory: inputs.loadHistory,
    setDebugMessage: inputs.actions.setDebugMessage,
    pendingItem: inputs.pendingItem,
    setPendingItem: inputs.setPendingItem,
    toggleCorgiMode: inputs.actions.toggleCorgiMode,
    toggleDebugProfiler: inputs.actions.toggleDebugProfiler,
    toggleVimEnabled: inputs.toggleVimEnabled,
    setLlxprtMdFileCount: inputs.setLlxprtMdFileCount,
    updateHistoryTokenCount: inputs.stats.updateHistoryTokenCount,
    reloadCommands: inputs.reloadCommands,
    extensionsUpdateState: inputs.extensionsUpdateState,
    dispatchExtensionStateUpdate: inputs.actions.dispatchExtensionStateUpdate,
    addConfirmUpdateExtensionRequest:
      inputs.actions.addConfirmUpdateExtensionRequest,
  };
}

export function useCommandReload(
  owners: BuiltinCommandOwners,
  config: CliUiRuntime | null,
  reloadTrigger: number,
  isConfigInitialized: boolean,
  reloadCommands: () => void,
  setCommands: (commands: readonly SlashCommand[]) => void,
  agent: Agent | null,
): void {
  useEffect(
    () => subscribeToExternalCommandChanges(config, reloadCommands, agent),
    [config, reloadCommands, agent],
  );
  useEffect(() => {
    const controller = new AbortController();
    void loadSlashCommands(owners, config, controller.signal, setCommands);
    return () => {
      controller.abort();
    };
  }, [owners, config, reloadTrigger, isConfigInitialized, setCommands]);
}

function subscribeToExternalCommandChanges(
  config: CliUiRuntime | null,
  reloadCommands: () => void,
  agent: Agent | null,
): (() => void) | undefined {
  if (!config) return undefined;
  const listener = () => {
    reloadCommands();
  };
  const ideClient = config.getIdeClient();
  ideClient?.addStatusChangeListener(listener);
  const unsubscribeMcp = agent?.mcp.subscribeStatus(listener);
  coreEvents.on(CoreEvent.FolderTrustChanged, listener);
  return () => {
    ideClient?.removeStatusChangeListener(listener);
    unsubscribeMcp?.();
    coreEvents.off(CoreEvent.FolderTrustChanged, listener);
  };
}

function shouldUseBuiltinCommandsOnly(): boolean {
  return process.env.LLXPRT_CODE_BUILTIN_COMMANDS_ONLY === 'true';
}

export function loadBuiltinSlashCommands(
  owners: BuiltinCommandOwners,
  config: CliUiRuntime | null,
): readonly SlashCommand[] {
  return new BuiltinCommandLoader(owners, config).loadCommandsSync();
}

async function loadSlashCommands(
  owners: BuiltinCommandOwners,
  config: CliUiRuntime | null,
  signal: AbortSignal,
  setCommands: (commands: readonly SlashCommand[]) => void,
): Promise<void> {
  try {
    const loaders: ICommandLoader[] = [
      new BuiltinCommandLoader(owners, config),
    ];
    if (!shouldUseBuiltinCommandsOnly()) {
      loaders.unshift(
        new McpPromptLoader(
          config
            ? {
                getMcpServers: () => config.getMcpServers(),
                listPrompts: (server) => config.listPrompts(server),
              }
            : null,
        ),
      );
      loaders.push(
        new FileCommandLoader(
          config
            ? {
                userCommandsDir: config.userCommandsDir,
                projectCommandsDir: config.projectCommandsDir,
                getProjectRoot: () => config.getProjectRoot(),
                getExtensions: () => config.getExtensions(),
                getFolderTrust: () => config.getFolderTrust(),
                isTrustedFolder: () => config.isTrustedFolder(),
              }
            : null,
          bindShellPromptOperations(config),
        ),
      );
    }
    const commandService = await CommandService.create(loaders, signal);
    if (!signal.aborted) {
      setCommands(commandService.getCommands());
    }
  } catch (error) {
    if (!signal.aborted) {
      slashCommandLogger.error(
        () => 'Failed to initialize slash commands',
        error,
      );
      setCommands([]);
    }
  }
}
