/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { type PartListUnion } from '@google/genai';
import type {
  Config,
  RecordingIntegration,
  Todo,
} from '@vybestack/llxprt-code-core';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { RecordingSwapCallbacks } from '../../services/performResume.js';
import { useSessionStats } from '../contexts/SessionContext.js';
import type {
  HistoryItemWithoutId,
  SlashCommandProcessorResult,
} from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';
import type { SlashCommand } from '../commands/types.js';
import type { ExtensionUpdateState } from '../state/extensions.js';
import { processSlashCommand } from './slashCommandHandlers.js';
import {
  confirmationLogger,
  slashCommandLogger,
  type SlashCommandProcessorActions,
} from './slashCommandProcessor.js';
import {
  useCommandContext,
  useCommandReload,
  useManagers,
  usePendingHistory,
} from './slashCommandProcessorSupport.js';

interface TodoContextValue {
  todos: Todo[];
  updateTodos: (todos: Todo[]) => void;
  refreshTodos: () => void;
}

export type SlashCommandProcessorCoreResult = {
  handleSlashCommand: (
    rawQuery: PartListUnion,
    oneTimeShellAllowlist?: Set<string>,
    overwriteConfirmed?: boolean,
    addToHistory?: boolean,
  ) => Promise<SlashCommandProcessorResult | false>;
  slashCommands: readonly SlashCommand[] | undefined;
  pendingHistoryItems: HistoryItemWithoutId[];
  commandContext: ReturnType<typeof useCommandContext>;
  confirmationRequest: {
    prompt: React.ReactNode;
    onConfirm: (confirmed: boolean) => void;
  } | null;
};

export interface UseSlashCommandProcessorCoreArgs {
  config: Config | null;
  settings: LoadedSettings;
  addItem: UseHistoryManagerReturn['addItem'];
  clearItems: UseHistoryManagerReturn['clearItems'];
  loadHistory: UseHistoryManagerReturn['loadHistory'];
  refreshStatic: () => void;
  toggleVimEnabled: () => Promise<boolean>;
  setIsProcessing: (isProcessing: boolean) => void;
  setLlxprtMdFileCount: (count: number) => void;
  actions: SlashCommandProcessorActions;
  extensionsUpdateState: Map<string, ExtensionUpdateState>;
  isConfigInitialized: boolean;
  todoContext?: TodoContextValue;
  recordingIntegration?: RecordingIntegration;
  recordingSwapCallbacks?: RecordingSwapCallbacks;
}

interface SlashCommandProcessorState {
  commands: readonly SlashCommand[] | undefined;
  setCommands: (commands: readonly SlashCommand[]) => void;
  reloadTrigger: number;
  reloadCommands: () => void;
  localIsProcessing: boolean;
  setLocalIsProcessing: (isProcessing: boolean) => void;
  sessionShellAllowlist: Set<string>;
  setSessionShellAllowlist: React.Dispatch<React.SetStateAction<Set<string>>>;
  confirmationRequest: {
    prompt: React.ReactNode;
    onConfirm: (confirmed: boolean) => void;
  } | null;
  setConfirmationRequest: (
    request: {
      prompt: React.ReactNode;
      onConfirm: (confirmed: boolean) => void;
    } | null,
  ) => void;
}

function useSlashCommandProcessorState(): SlashCommandProcessorState {
  const [commands, setCommands] = useState<readonly SlashCommand[] | undefined>(
    undefined,
  );
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [localIsProcessing, setLocalIsProcessing] = useState(false);
  const [sessionShellAllowlist, setSessionShellAllowlist] = useState(
    new Set<string>(),
  );
  const [confirmationRequest, setConfirmationRequest] = useState<null | {
    prompt: React.ReactNode;
    onConfirm: (confirmed: boolean) => void;
  }>(null);
  const reloadCommands = useCallback(() => {
    setReloadTrigger((v) => v + 1);
  }, []);
  return {
    commands,
    setCommands,
    reloadTrigger,
    reloadCommands,
    localIsProcessing,
    setLocalIsProcessing,
    sessionShellAllowlist,
    setSessionShellAllowlist,
    confirmationRequest,
    setConfirmationRequest,
  };
}

export function useSlashCommandProcessorCore(
  args: UseSlashCommandProcessorCoreArgs,
): SlashCommandProcessorCoreResult {
  const session = useSessionStats();
  const state = useSlashCommandProcessorState();
  const managers = useManagers(args.config);
  const pending = usePendingHistory(args.addItem);
  const commandContext = useCommandContext({
    config: args.config,
    settings: args.settings,
    ...managers,
    addItem: args.addItem,
    clearItems: args.clearItems,
    loadHistory: args.loadHistory,
    refreshStatic: args.refreshStatic,
    toggleVimEnabled: args.toggleVimEnabled,
    setLlxprtMdFileCount: args.setLlxprtMdFileCount,
    actions: args.actions,
    alternateBuffer:
      args.settings.merged.ui.useAlternateBuffer === true &&
      !(args.config?.getScreenReader() ?? false),
    ...pending,
    sessionShellAllowlist: state.sessionShellAllowlist,
    localIsProcessing: state.localIsProcessing,
    reloadCommands: state.reloadCommands,
    extensionsUpdateState: args.extensionsUpdateState,
    todoContext: args.todoContext,
    recordingIntegration: args.recordingIntegration,
    recordingSwapCallbacks: args.recordingSwapCallbacks,
    stats: session,
  });
  useCommandReload(
    args.config,
    state.reloadTrigger,
    args.isConfigInitialized,
    state.reloadCommands,
    state.setCommands,
  );
  const handleSlashCommand = useCallback(
    (
      rawQuery: PartListUnion,
      oneTimeShellAllowlist?: Set<string>,
      overwriteConfirmed: boolean | undefined = undefined,
      addToHistory: boolean = true,
    ): Promise<SlashCommandProcessorResult | false> =>
      processSlashCommand(
        {
          commands: state.commands,
          config: args.config,
          commandContext,
          actions: args.actions,
          addItem: args.addItem,
          addMessage: pending.addMessage,
          setIsProcessing: args.setIsProcessing,
          setLocalIsProcessing: state.setLocalIsProcessing,
          setPendingItem: pending.setPendingItem,
          setSessionShellAllowlist: state.setSessionShellAllowlist,
          setConfirmationRequest: state.setConfirmationRequest,
          recordingIntegration: args.recordingIntegration,
          recordingSwapCallbacks: args.recordingSwapCallbacks,
          confirmationLogger,
          slashCommandLogger,
        },
        rawQuery,
        oneTimeShellAllowlist,
        overwriteConfirmed,
        addToHistory,
      ),
    [args, commandContext, pending, state],
  );
  return {
    handleSlashCommand,
    slashCommands: state.commands,
    pendingHistoryItems: pending.pendingHistoryItems,
    commandContext,
    confirmationRequest: state.confirmationRequest,
  };
}
