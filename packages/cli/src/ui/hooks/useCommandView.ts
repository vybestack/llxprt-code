/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback } from 'react';
import type {
  UseSlashCommandProcessorCoreArgs,
  SlashCommandProcessorCoreResult,
  SlashCommandProcessorState,
} from './useSlashCommandProcessorCore.js';
import {
  useCommandContext,
  type usePendingHistory,
} from './slashCommandProcessorSupport.js';
import type { useCommandRuntimeState } from './useCommandRuntimeState.js';
import type { SlashCommandCancellation } from './useSlashCommandCancellation.js';
import {
  processSlashCommand,
  type SlashCommandHandlerDeps,
} from './slashCommandHandlers.js';

function useInvocationContext(
  input: Pick<
    UseSlashCommandProcessorCoreArgs,
    | 'addItem'
    | 'clearItems'
    | 'loadHistory'
    | 'refreshStatic'
    | 'toggleVimEnabled'
    | 'setLlxprtMdFileCount'
    | 'actions'
    | 'extensionsUpdateState'
    | 'todoContext'
  >,
  alternateBuffer: boolean,
  state: SlashCommandProcessorState,
  pending: ReturnType<typeof usePendingHistory>,
  session: ReturnType<typeof useCommandRuntimeState>['session'],
) {
  return useCommandContext({
    addItem: input.addItem,
    clearItems: input.clearItems,
    loadHistory: input.loadHistory,
    refreshStatic: input.refreshStatic,
    toggleVimEnabled: input.toggleVimEnabled,
    setLlxprtMdFileCount: input.setLlxprtMdFileCount,
    actions: input.actions,
    alternateBuffer,
    ...pending,
    sessionShellAllowlist: state.sessionShellAllowlist,
    localIsProcessing: state.localIsProcessing,
    reloadCommands: state.reloadCommands,
    extensionsUpdateState: input.extensionsUpdateState,
    todoContext: input.todoContext,
    stats: session,
  });
}

export function useCommandView(
  invocation: Parameters<typeof useInvocationContext>[0],
  alternateBuffer: boolean,
  state: SlashCommandProcessorState,
  pending: ReturnType<typeof usePendingHistory>,
  session: ReturnType<typeof useCommandRuntimeState>['session'],
  cancellation: SlashCommandCancellation,
  createHandlers: (
    context: ReturnType<typeof useCommandContext>,
  ) => SlashCommandHandlerDeps,
): SlashCommandProcessorCoreResult {
  const commandContext = useInvocationContext(
    invocation,
    alternateBuffer,
    state,
    pending,
    session,
  );
  const handleSlashCommand = useCommandHandler(createHandlers(commandContext));
  return {
    handleSlashCommand,
    slashCommands: state.commands,
    pendingHistoryItems: pending.pendingHistoryItems,
    commandContext,
    cancelActiveSlashCommand: cancellation.cancelActiveSlashCommand,
  };
}

function useCommandHandler(
  deps: SlashCommandHandlerDeps,
): SlashCommandProcessorCoreResult['handleSlashCommand'] {
  return useCallback((...input) => processSlashCommand(deps, ...input), [deps]);
}
