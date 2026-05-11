/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import process from 'node:process';
import * as path from 'node:path';
import * as os from 'node:os';
import type {
  Config,
  RecordingIntegration,
  Todo,
} from '@vybestack/llxprt-code-core';
import {
  GitService,
  IdeClient,
  Logger,
  ProfileManager,
  Storage,
  SubagentManager,
  addMCPStatusChangeListener,
  removeMCPStatusChangeListener,
} from '@vybestack/llxprt-code-core';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { RecordingSwapCallbacks } from '../../services/performResume.js';
import type { Message, HistoryItemWithoutId } from '../types.js';
import { MessageType } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import { CommandService } from '../../services/CommandService.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { FileCommandLoader } from '../../services/FileCommandLoader.js';
import { McpPromptLoader } from '../../services/McpPromptLoader.js';
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
  config: Config | null;
  settings: LoadedSettings;
  gitService: GitService | undefined;
  logger: Logger;
  profileManager: ProfileManager | undefined;
  subagentManager: SubagentManager | undefined;
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
  recordingIntegration: RecordingIntegration | undefined;
  recordingSwapCallbacks: RecordingSwapCallbacks | undefined;
  stats: {
    stats: CommandContext['session']['stats'];
    updateHistoryTokenCount: (count: number) => void;
  };
}

function convertMessageToHistoryItem(message: Message): HistoryItemWithoutId {
  switch (message.type) {
    case MessageType.ABOUT:
      return {
        type: 'about',
        cliVersion: message.cliVersion,
        osVersion: message.osVersion,
        sandboxEnv: message.sandboxEnv,
        modelVersion: message.modelVersion,
        gcpProject: message.gcpProject,
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

export function useManagers(config: Config | null): {
  gitService: GitService | undefined;
  logger: Logger;
  profileManager: ProfileManager | undefined;
  subagentManager: SubagentManager | undefined;
} {
  const gitService = useMemo(() => {
    if (!config?.getProjectRoot()) return undefined;
    return new GitService(config.getProjectRoot(), config.storage);
  }, [config]);
  const logger = useMemo(
    () =>
      new Logger(
        config?.getSessionId() ?? '',
        config?.storage ?? new Storage(process.cwd()),
      ),
    [config],
  );
  const profileManager = useMemo(() => {
    if (!config) return undefined;
    return new ProfileManager(path.join(os.homedir(), '.llxprt', 'profiles'));
  }, [config]);
  const subagentManager = useMemo(() => {
    if (!config || !profileManager) return undefined;
    return new SubagentManager(
      path.join(os.homedir(), '.llxprt', 'subagents'),
      profileManager,
    );
  }, [config, profileManager]);
  return { gitService, logger, profileManager, subagentManager };
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

export function useCommandContext(
  inputs: CommandContextInputs,
): CommandContext {
  return useMemo(
    (): CommandContext => ({
      services: {
        config: inputs.config,
        settings: inputs.settings,
        git: inputs.gitService,
        logger: inputs.logger,
        profileManager: inputs.profileManager,
        subagentManager: inputs.subagentManager,
      },
      ui: buildCommandContextUi(inputs),
      session: {
        stats: inputs.stats.stats,
        sessionShellAllowlist: inputs.sessionShellAllowlist,
        isProcessing: inputs.localIsProcessing,
      },
      todoContext: inputs.todoContext,
      recordingIntegration: inputs.recordingIntegration,
      recordingSwapCallbacks: inputs.recordingSwapCallbacks,
    }),
    [inputs],
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
        // eslint-disable-next-line no-console
        console.clear();
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
    setGeminiMdFileCount: inputs.setLlxprtMdFileCount,
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
  config: Config | null,
  reloadTrigger: number,
  isConfigInitialized: boolean,
  reloadCommands: () => void,
  setCommands: (commands: readonly SlashCommand[]) => void,
): void {
  useEffect(
    () => subscribeToExternalCommandChanges(config, reloadCommands),
    [config, reloadCommands],
  );
  useEffect(() => {
    const controller = new AbortController();
    void loadSlashCommands(config, controller.signal, setCommands);
    return () => {
      controller.abort();
    };
  }, [config, reloadTrigger, isConfigInitialized, setCommands]);
}

function subscribeToExternalCommandChanges(
  config: Config | null,
  reloadCommands: () => void,
): (() => void) | undefined {
  if (!config) return undefined;
  const listener = () => {
    reloadCommands();
  };
  void IdeClient.getInstance().then((client) => {
    client.addStatusChangeListener(listener);
  });
  addMCPStatusChangeListener(listener);
  return () => {
    void IdeClient.getInstance().then((client) => {
      client.removeStatusChangeListener(listener);
    });
    removeMCPStatusChangeListener(listener);
  };
}

async function loadSlashCommands(
  config: Config | null,
  signal: AbortSignal,
  setCommands: (commands: readonly SlashCommand[]) => void,
): Promise<void> {
  try {
    const loaders = [
      new McpPromptLoader(config),
      new BuiltinCommandLoader(config),
      new FileCommandLoader(config),
    ];
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
