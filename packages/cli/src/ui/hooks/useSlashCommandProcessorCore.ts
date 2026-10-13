/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CliUiRuntime } from '../cliUiRuntime.js';
import { useCallback, useMemo, useState } from 'react';
import { createToolFormatCommand } from '../commands/toolformatCommand.js';
import { createModelCommand } from '../commands/modelCommand.js';
import { createSetCommand } from '../commands/setCommand.js';
import { createProviderCommand } from '../commands/providerCommand.js';
import { bindProviderCommandOperations } from '../commands/providerCommandHost.js';
import { useCredentialCommands } from './useCredentialCommands.js';
import type { DialogStore } from '../stores/dialog/dialogStore.js';
import type {
  RecordingIntegration,
  ModelChangeResult,
  Todo,
  AgentRequestInput,
} from '@vybestack/llxprt-code-core';
import type {
  Agent,
  ToolFormatState,
  ToolFormatOverrideLiteral,
} from '@vybestack/llxprt-code-agents';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { RecordingSwapCallbacks } from '../../services/performResume.js';
import { useSessionStats } from '../contexts/SessionContext.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import { useProviderAliasRefresh } from '../contexts/ProviderAliasRefreshContext.js';
import { useOAuthControl } from '../contexts/OAuthControlContext.js';
import type {
  HistoryItemWithoutId,
  SlashCommandProcessorResult,
} from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';
import type { SlashCommand } from '../commands/types.js';
import type { ExtensionUpdateState } from '../state/extensions.js';
import {
  processSlashCommand,
  type SlashCommandHandlerDeps,
} from './slashCommandHandlers.js';
import {
  confirmationLogger,
  slashCommandLogger,
  type SlashCommandProcessorActions,
} from './slashCommandProcessor.js';
import type { BuiltinCommandOwners } from '../../services/BuiltinCommandLoader.js';
import {
  loadBuiltinSlashCommands,
  useCommandContext,
  useCommandReload,
  useManagers,
  usePendingHistory,
} from './slashCommandProcessorSupport.js';
import {
  useSlashCommandCancellation,
  type SlashCommandCancellation,
} from './useSlashCommandCancellation.js';

interface TodoContextValue {
  todos: Todo[];
  updateTodos: (todos: Todo[]) => void;
  refreshTodos: () => void;
}

export type SlashCommandProcessorCoreResult = {
  handleSlashCommand: (
    rawQuery: AgentRequestInput,
    oneTimeShellAllowlist?: Set<string>,
    overwriteConfirmed?: boolean,
    addToHistory?: boolean,
  ) => Promise<SlashCommandProcessorResult | false>;
  slashCommands: readonly SlashCommand[] | undefined;
  pendingHistoryItems: HistoryItemWithoutId[];
  commandContext: ReturnType<typeof useCommandContext>;
  /** Aborts every in-flight slash command. Returns true iff any was aborted. */
  cancelActiveSlashCommand: () => boolean;
};

export interface UseSlashCommandProcessorCoreArgs {
  config: CliUiRuntime | null;
  agent: Agent | null;
  settings: LoadedSettings;
  addItem: UseHistoryManagerReturn['addItem'];
  clearItems: UseHistoryManagerReturn['clearItems'];
  loadHistory: UseHistoryManagerReturn['loadHistory'];
  refreshStatic: () => void;
  toggleVimEnabled: () => Promise<boolean>;
  setIsProcessing: (isProcessing: boolean) => void;
  setLlxprtMdFileCount: (count: number) => void;
  actions: SlashCommandProcessorActions;
  store: DialogStore;
  extensionsUpdateState: Map<string, ExtensionUpdateState>;
  isConfigInitialized: boolean;
  todoContext?: TodoContextValue;
  recordingIntegration?: RecordingIntegration;
  recordingOwner?: 'agent' | 'raw';
  recordingSwapCallbacks?: RecordingSwapCallbacks;
}

interface SlashCommandProcessorState {
  builtins: BuiltinCommandOwners;
  commands: readonly SlashCommand[] | undefined;
  setCommands: (commands: readonly SlashCommand[]) => void;
  reloadTrigger: number;
  reloadCommands: () => void;
  localIsProcessing: boolean;
  setLocalIsProcessing: (isProcessing: boolean) => void;
  sessionShellAllowlist: Set<string>;
  setSessionShellAllowlist: React.Dispatch<React.SetStateAction<Set<string>>>;
}

function useCommandState(
  selectModel: (model: string) => Promise<ModelChangeResult>,
  readToolFormat: () => Promise<ToolFormatState>,
  writeToolFormat: (
    format: ToolFormatOverrideLiteral | null,
  ) => Promise<ToolFormatState>,
  settings: LoadedSettings,
  agent: Agent | null,
  refreshProviderAliases: () => Promise<void>,
  rawRecording: Pick<RecordingIntegration, 'recordProviderSwitch'> | undefined,
  recordingOwner: 'agent' | 'raw' | undefined,
  config: CliUiRuntime | null,
): SlashCommandProcessorState {
  const recordProviderSwitch = useProviderSwitchRecorder(
    agent?.session ?? null,
    rawRecording,
    recordingOwner,
  );
  const modelCommand = useMemo(
    () => createModelCommand(selectModel, recordProviderSwitch),
    [selectModel, recordProviderSwitch],
  );
  const providerCommand = useRegisteredProviderCommand(
    agent,
    refreshProviderAliases,
    recordProviderSwitch,
  );
  const toolFormatCommand = useMemo(
    () => createToolFormatCommand(readToolFormat, writeToolFormat),
    [readToolFormat, writeToolFormat],
  );
  const setCommand = useSetCommand(settings);
  const credentialCommands = useCredentialCommands(agent, settings, config);
  const builtins = useMemo<BuiltinCommandOwners>(
    () => ({
      modelCommand,
      toolFormatCommand,
      setCommand,
      providerCommand,
      ...credentialCommands,
    }),
    [
      modelCommand,
      toolFormatCommand,
      setCommand,
      providerCommand,
      credentialCommands,
    ],
  );
  const [commands, setCommands] = useState<readonly SlashCommand[] | undefined>(
    () =>
      process.env.LLXPRT_CODE_BUILTIN_COMMANDS_ONLY === 'true'
        ? loadBuiltinSlashCommands(builtins, config, recordingOwner)
        : undefined,
  );
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [localIsProcessing, setLocalIsProcessing] = useState(false);
  const [sessionShellAllowlist, setSessionShellAllowlist] = useState(
    new Set<string>(),
  );
  const reloadCommands = useCallback(() => {
    setReloadTrigger((v) => v + 1);
  }, []);
  return {
    builtins,
    commands,
    setCommands,
    reloadTrigger,
    reloadCommands,
    localIsProcessing,
    setLocalIsProcessing,
    sessionShellAllowlist,
    setSessionShellAllowlist,
  };
}

function buildHandlerDeps(
  args: UseSlashCommandProcessorCoreArgs,
  state: SlashCommandProcessorState,
  pending: ReturnType<typeof usePendingHistory>,
  commandContext: ReturnType<typeof useCommandContext>,
  cancellation: SlashCommandCancellation,
): SlashCommandHandlerDeps {
  return {
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
    setConfirmationRequest: (request) => {
      args.store.commands.setConfirmationRequest(request);
    },
    recordingIntegration: args.recordingIntegration,
    recordingSwapCallbacks: args.recordingSwapCallbacks,
    sessionPersistence: args.config?.sessionPersistence,
    confirmationLogger,
    slashCommandLogger,
    beginSlashCommandAction: cancellation.beginSlashCommandAction,
    endSlashCommandAction: cancellation.endSlashCommandAction,
  };
}

function useProviderSwitchRecorder(
  ownedRecording: Pick<Agent['session'], 'recordRecordingEvent'> | null,
  rawRecording: Pick<RecordingIntegration, 'recordProviderSwitch'> | undefined,
  recordingOwner: 'agent' | 'raw' | undefined,
): (provider: string, model: string) => Promise<void> {
  return useCallback(
    async (provider, model) => {
      if (recordingOwner === 'agent') {
        if (ownedRecording === null)
          throw new Error('Session agent is unavailable');
        await ownedRecording.recordRecordingEvent({
          type: 'provider_switch',
          provider,
          model,
        });
      } else {
        rawRecording?.recordProviderSwitch(provider, model);
      }
    },
    [ownedRecording, rawRecording, recordingOwner],
  );
}

function useRegisteredProviderCommand(
  agent: Agent | null,
  refreshProviderAliases: () => Promise<void>,
  recordProviderSwitch: (provider: string, model: string) => Promise<void>,
): SlashCommand {
  const api = useRuntimeApi();
  return useMemo(
    () =>
      createProviderCommand(
        bindProviderCommandOperations(
          api,
          agent,
          refreshProviderAliases,
          recordProviderSwitch,
        ),
      ),
    [api, agent, recordProviderSwitch, refreshProviderAliases],
  );
}

function useSetCommand(settings: LoadedSettings): SlashCommand {
  const api = useRuntimeApi();
  const enableFuzzyFiltering = settings.merged.enableFuzzyFiltering ?? true;
  return useMemo(
    () =>
      createSetCommand({
        getEphemeralSettings: () => api.getEphemeralSettings(),
        setEphemeralSetting: (key, value) =>
          api.setEphemeralSetting(key, value),
        getActiveModelParams: () => api.getActiveModelParams(),
        setActiveModelParam: (key, value) =>
          api.setActiveModelParam(key, value),
        clearActiveModelParam: (key) => api.clearActiveModelParam(key),
        isFuzzyFilteringEnabled: () => enableFuzzyFiltering,
      }),
    [api, enableFuzzyFiltering],
  );
}

export function useSlashCommandProcessorCore(
  args: UseSlashCommandProcessorCoreArgs,
): SlashCommandProcessorCoreResult {
  const api = useRuntimeApi();
  const refreshProviderAliases = useProviderAliasRefresh();
  const oauthControl = useOAuthControl();
  const session = useSessionStats();
  const state = useCommandState(
    useMemo(() => api.setActiveModel.bind(api), [api]),
    useMemo(() => api.getActiveToolFormatState.bind(api), [api]),
    useMemo(() => api.setActiveToolFormatOverride.bind(api), [api]),
    args.settings,
    args.agent,
    refreshProviderAliases,
    args.recordingIntegration,
    args.recordingOwner,
    args.config,
  );
  const cancellation = useSlashCommandCancellation();
  const managers = useManagers(args.config, args.agent ?? undefined);
  const pending = usePendingHistory(args.addItem);
  const commandContext = useCommandContext({
    runtimeApi: api,
    refreshProviderAliases,
    oauthControl,
    config: args.config,
    agent: args.agent,
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
    recordingOwner: args.recordingOwner,
    recordingSwapCallbacks: args.recordingSwapCallbacks,
    stats: session,
  });
  useCommandReload(
    state.builtins,
    args.config,
    state.reloadTrigger,
    args.isConfigInitialized,
    state.reloadCommands,
    state.setCommands,
    args.agent,
    args.recordingOwner,
  );
  const handleSlashCommand = useCallback(
    (
      ...input: Parameters<
        SlashCommandProcessorCoreResult['handleSlashCommand']
      >
    ): Promise<SlashCommandProcessorResult | false> =>
      processSlashCommand(
        buildHandlerDeps(args, state, pending, commandContext, cancellation),
        ...input,
      ),
    [args, commandContext, pending, state, cancellation],
  );
  return {
    handleSlashCommand,
    slashCommands: state.commands,
    pendingHistoryItems: pending.pendingHistoryItems,
    commandContext,
    cancelActiveSlashCommand: cancellation.cancelActiveSlashCommand,
  };
}
