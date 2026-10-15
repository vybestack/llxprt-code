import { bindCommandHistoryLoader } from './commandHistoryLoaderHost.js';
import { resolveEmojiFilterMode } from '../utils/iContentToHistoryItems.js';
import { bindCommandErrorRecorder } from './commandErrorRecorderHost.js';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useHistoryCommandOwners } from './useHistoryCommandOwners.js';
import { useOAuthControl } from '../contexts/OAuthControlContext.js';

import { useCommandRuntimeState } from './useCommandRuntimeState.js';
import { useRegisteredCommandReload } from './useRegisteredCommandReload.js';
import { useHostCommands } from './useHostCommands.js';
import { useResourceCommands } from './useResourceCommands.js';
import { useUtilityCommands } from './useUtilityCommands.js';
import { usePresentationCommands } from './usePresentationCommands.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import { useCallback, useMemo, useState } from 'react';
import { createToolFormatCommand } from '../commands/toolformatCommand.js';
import { createModelCommand } from '../commands/modelCommand.js';
import { useSetCommand } from './useSetCommand.js';
import { createProviderCommand } from '../commands/providerCommand.js';
import { bindProviderCommandOperations } from '../commands/providerCommandHost.js';
import { useCredentialCommands } from './useCredentialCommands.js';
import { useChatCommand } from './useChatCommand.js';
import { createContinueCommand } from '../commands/continueCommand.js';
import { bindContinueCommandOperations } from '../commands/continueCommandHost.js';
import { useExtensionCommand } from './useExtensionCommand.js';
import { useSubagentCommand } from './useSubagentCommand.js';
import { createTodoCommand } from '../commands/todoCommand.js';
import { createHooksCommand } from '../commands/hooksCommand.js';
import { createTaskCommand } from '../commands/tasksCommand.js';
import {
  bindHooksCommand,
  bindTaskCommand,
} from '../commands/hookTaskCommandHost.js';
import { createToolsCommand } from '../commands/toolsCommand.js';
import { bindToolsCommand } from '../commands/toolsCommandHost.js';
import { createDirectoryCommand } from '../commands/directoryCommand.js';
import { bindDirectoryCommand } from '../commands/directoryCommandHost.js';
import { createMemoryCommand } from '../commands/memoryCommand.js';
import { bindMemoryCommand } from '../commands/memoryCommandHost.js';
import { createImageCommand } from '../commands/imageCommand.js';
import { bindImageCommand } from '../commands/imageCommandHost.js';
import { createBugCommand } from '../commands/bugCommand.js';
import { bindBugCommand } from '../commands/bugCommandHost.js';
import { createPoliciesCommand } from '../commands/policiesCommand.js';
import { bindPoliciesCommand } from '../commands/policiesCommandHost.js';
import type { DialogStore } from '../stores/dialog/dialogStore.js';
import type {
  RecordingIntegration,
  ModelChangeResult,
  Todo,
  AgentRequestInput,
} from '@vybestack/llxprt-code-core';
import type { Agent, ToolFormatState } from '@vybestack/llxprt-code-agents';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { RecordingSwapCallbacks } from '../../services/performResume.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import { useProviderAliasRefresh } from '../contexts/ProviderAliasRefreshContext.js';
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
  type usePendingHistory,
} from './slashCommandProcessorSupport.js';
import { type SlashCommandCancellation } from './useSlashCommandCancellation.js';

type WriteToolFormat = Parameters<typeof createToolFormatCommand>[1];

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

function useTodoCommandOwner(
  todos: TodoContextValue | undefined,
  addItem: UseHistoryManagerReturn['addItem'],
): SlashCommand {
  return useMemo(
    () =>
      createTodoCommand(
        todos
          ? {
              readTodos: () => todos.todos,
              updateTodos: (value) => todos.updateTodos(value),
            }
          : null,
        addItem,
      ),
    [todos, addItem],
  );
}

type RegisteredPresentationCommands = ReturnType<
  typeof usePresentationCommands
> &
  ReturnType<typeof useUtilityCommands> &
  ReturnType<typeof useResourceCommands> &
  ReturnType<typeof useHostCommands>;

function useCommandState(
  settings: LoadedSettings,
  agent: Agent | null,
  addItem: UseHistoryManagerReturn['addItem'],
  historyCommandOwners: ReturnType<typeof useHistoryCommandOwners>,
  setMemoryFileCount: (count: number) => void,
  todoContext: TodoContextValue | undefined,
  reloadCommands: () => void,
  refreshProviderAliases: () => Promise<void>,
  rawRecording: RecordingIntegration | undefined,
  recordingOwner: 'agent' | 'raw' | undefined,
  recordingSwapCallbacks: RecordingSwapCallbacks | undefined,
  config: CliUiRuntime | null,
  runtimeApi: ReturnType<typeof useRuntimeApi>,
  extensionsCommand: SlashCommand,
  presentationCommands: RegisteredPresentationCommands,
): SlashCommandProcessorState {
  const rec = useSwitch(agent?.session, rawRecording, recordingOwner);
  const modelCommand = useModelCommand(
    useMemo(() => runtimeApi.setActiveModel.bind(runtimeApi), [runtimeApi]),
    rec,
  );
  const provider = useProviderCommand(agent, refreshProviderAliases, rec);
  const toolFormatCommand = useToolFormatCommand(
    useMemo(
      () => runtimeApi.getActiveToolFormatState.bind(runtimeApi),
      [runtimeApi],
    ),
    useMemo(
      () => runtimeApi.setActiveToolFormatOverride.bind(runtimeApi),
      [runtimeApi],
    ),
  );
  const credentialCommands = useCredentialCommands(
    agent,
    settings,
    config,
    rec,
    addItem,
    reloadCommands,
  );
  const chatCommand = useChatCommand(
    agent,
    config,
    recordingOwner,
    rawRecording,
    recordingSwapCallbacks,
    useCallback(() => settings.merged.enableFuzzyFiltering ?? true, [settings]),
  );
  const workspaceCommands = useWorkspaceCommandOwners(
    config,
    agent,
    recordingOwner,
    rawRecording,
    addItem,
    setMemoryFileCount,
  );
  const builtins = useBuiltinCommandOwners({
    chatCommand,
    continueCommand: useContinueCommandOwner(agent, config, recordingOwner),
    historyCommandOwners,
    modelCommand,
    toolFormatCommand,
    setCommand: useSetCommand(settings),
    provider,
    todoCommand: useTodoCommandOwner(todoContext, addItem),
    subagentCommand: useSubagentCommand(agent, config, settings, addItem),
    extensionsCommand,
    presentationCommands,
    ...workspaceCommands,
    credentialCommands,
  });
  return { builtins, ...useRegistryState(builtins, config) };
}

function useDirectoryCommandOwner(
  config: CliUiRuntime | null,
  agent: Agent | null,
  recordingOwner: 'agent' | 'raw' | undefined,
  recordingIntegration: RecordingIntegration | undefined,
  addItem: UseHistoryManagerReturn['addItem'],
  setMemoryFileCount: (count: number) => void,
): SlashCommand {
  return useMemo(
    () =>
      createDirectoryCommand(
        bindDirectoryCommand(
          config,
          agent,
          recordingOwner,
          recordingIntegration,
          addItem,
          setMemoryFileCount,
        ),
      ),
    [
      config,
      agent,
      recordingOwner,
      recordingIntegration,
      addItem,
      setMemoryFileCount,
    ],
  );
}

type BuiltinCommandOwnerParts = Pick<
  BuiltinCommandOwners,
  | 'chatCommand'
  | 'continueCommand'
  | 'modelCommand'
  | 'toolFormatCommand'
  | 'setCommand'
  | 'extensionsCommand'
  | 'subagentCommand'
> & {
  presentationCommands: RegisteredPresentationCommands;
  historyCommandOwners: ReturnType<typeof useHistoryCommandOwners>;
  provider: SlashCommand;
  toolsCommand: SlashCommand;
  directoryCommand: SlashCommand;
  memoryCommand: SlashCommand;
  imageCommand: SlashCommand;
  bugCommand: SlashCommand;
  policiesCommand: SlashCommand;
  hooksCommand: SlashCommand;
  taskCommand: SlashCommand;
  todoCommand: SlashCommand;
  credentialCommands: ReturnType<typeof useCredentialCommands>;
};

function useBuiltinCommandOwners(
  parts: BuiltinCommandOwnerParts,
): BuiltinCommandOwners {
  const {
    chatCommand,
    continueCommand,
    historyCommandOwners,
    presentationCommands,
    modelCommand,
    toolFormatCommand,
    setCommand,
    provider,
    toolsCommand,
    directoryCommand,
    memoryCommand,
    imageCommand,
    bugCommand,
    policiesCommand,
    hooksCommand,
    taskCommand,
    todoCommand,
    credentialCommands,
    extensionsCommand,
    subagentCommand,
  } = parts;
  return useMemo(
    () => ({
      chatCommand,
      continueCommand,
      ...historyCommandOwners,
      ...presentationCommands,
      modelCommand,
      toolFormatCommand,
      setCommand,
      providerCommand: provider,
      toolsCommand,
      directoryCommand,
      memoryCommand,
      imageCommand,
      bugCommand,
      policiesCommand,
      hooksCommand,
      taskCommand,
      todoCommand,
      extensionsCommand,
      subagentCommand,
      ...credentialCommands,
    }),
    [
      chatCommand,
      continueCommand,
      historyCommandOwners,
      presentationCommands,
      modelCommand,
      toolFormatCommand,
      setCommand,
      provider,
      toolsCommand,
      directoryCommand,
      memoryCommand,
      imageCommand,
      bugCommand,
      policiesCommand,
      hooksCommand,
      taskCommand,
      todoCommand,
      credentialCommands,
      extensionsCommand,
      subagentCommand,
    ],
  );
}

function useBugCommandOwner(
  config: CliUiRuntime | null,
  agent: Agent | null,
  addItem: UseHistoryManagerReturn['addItem'],
): SlashCommand {
  return useMemo(
    () => createBugCommand(bindBugCommand(config, agent, addItem)),
    [config, agent, addItem],
  );
}

function useMemoryCommandOwner(
  config: CliUiRuntime | null,
  addItem: UseHistoryManagerReturn['addItem'],
  setMemoryFileCount: (count: number) => void,
): SlashCommand {
  return useMemo(
    () =>
      createMemoryCommand(
        bindMemoryCommand(config, addItem, setMemoryFileCount),
      ),
    [config, addItem, setMemoryFileCount],
  );
}

function useWorkspaceCommandOwners(
  config: CliUiRuntime | null,
  agent: Agent | null,
  recordingOwner: 'agent' | 'raw' | undefined,
  recordingIntegration: RecordingIntegration | undefined,
  addItem: UseHistoryManagerReturn['addItem'],
  setMemoryFileCount: (count: number) => void,
): {
  memoryCommand: SlashCommand;
  bugCommand: SlashCommand;
  policiesCommand: SlashCommand;
  toolsCommand: SlashCommand;
  directoryCommand: SlashCommand;
  imageCommand: SlashCommand;
  hooksCommand: SlashCommand;
  taskCommand: SlashCommand;
} {
  const memoryCommand = useMemoryCommandOwner(
    config,
    addItem,
    setMemoryFileCount,
  );
  const bugCommand = useBugCommandOwner(config, agent, addItem);
  const policiesCommand = useMemo(
    () => createPoliciesCommand(bindPoliciesCommand(() => agent)),
    [agent],
  );
  return {
    memoryCommand,
    bugCommand,
    policiesCommand,
    hooksCommand: useMemo(
      () =>
        createHooksCommand(bindHooksCommand(agent, config !== null), addItem),
      [agent, config, addItem],
    ),
    taskCommand: useMemo(
      () => createTaskCommand(bindTaskCommand(agent), addItem),
      [agent, addItem],
    ),
    toolsCommand: useToolsCommandOwner(agent, addItem),
    directoryCommand: useDirectoryCommandOwner(
      config,
      agent,
      recordingOwner,
      recordingIntegration,
      addItem,
      setMemoryFileCount,
    ),
    imageCommand: useImageCommandOwner(config, agent, addItem),
  };
}

function useImageCommandOwner(
  config: CliUiRuntime | null,
  agent: Agent | null,
  addItem: UseHistoryManagerReturn['addItem'],
): SlashCommand {
  return useMemo(
    () => createImageCommand(bindImageCommand(config, agent, addItem)),
    [config, agent, addItem],
  );
}

function useToolsCommandOwner(
  agent: Agent | null,
  addItem: UseHistoryManagerReturn['addItem'],
): SlashCommand {
  return useMemo(
    () => createToolsCommand(bindToolsCommand(agent), addItem),
    [agent, addItem],
  );
}

function useContinueCommandOwner(
  agent: Agent | null,
  config: CliUiRuntime | null,
  recordingOwner: 'agent' | 'raw' | undefined,
): SlashCommand {
  return useMemo(
    () =>
      createContinueCommand(
        bindContinueCommandOperations(
          agent,
          config,
          recordingOwner === 'agent' ? 'agent' : undefined,
        ),
      ),
    [agent, config, recordingOwner],
  );
}

function useModelCommand(
  selectModel: (model: string) => Promise<ModelChangeResult>,
  recordProviderSwitch: ReturnType<typeof useSwitch>,
): SlashCommand {
  return useMemo(
    () => createModelCommand(selectModel, recordProviderSwitch),
    [selectModel, recordProviderSwitch],
  );
}

function useToolFormatCommand(
  readToolFormat: () => Promise<ToolFormatState>,
  writeToolFormat: WriteToolFormat,
): SlashCommand {
  return useMemo(
    () => createToolFormatCommand(readToolFormat, writeToolFormat),
    [readToolFormat, writeToolFormat],
  );
}

function useRegistryState(
  builtins: BuiltinCommandOwners,
  config: CliUiRuntime | null,
): Omit<SlashCommandProcessorState, 'builtins'> {
  const [commands, setCommands] = useState<readonly SlashCommand[] | undefined>(
    () =>
      process.env.LLXPRT_CODE_BUILTIN_COMMANDS_ONLY === 'true'
        ? loadBuiltinSlashCommands(builtins, config)
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
    loadCommandHistory: bindCommandHistoryLoader(
      async (history) => {
        if (!args.agent) throw new Error('Session agent is unavailable');
        await args.agent.setHistory(history);
      },
      () => resolveEmojiFilterMode(args.config),
      commandContext.ui.clear,
      args.addItem,
    ),
    recordCommandError: bindCommandErrorRecorder(
      args.agent,
      args.recordingOwner,
      args.recordingIntegration,
    ),
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

function useSwitch(
  ownedRecording:
    | Pick<Agent['session'], 'recordRecordingEvent'>
    | null
    | undefined,
  rawRecording: Pick<RecordingIntegration, 'recordProviderSwitch'> | undefined,
  recordingOwner: 'agent' | 'raw' | undefined,
): (provider: string, model: string) => Promise<void> {
  return useCallback(
    async (provider, model) => {
      if (recordingOwner === 'agent') {
        if (ownedRecording == null)
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

function useProviderCommand(
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

function useRegisteredCommands(
  args: UseSlashCommandProcessorCoreArgs,
  runtimeApi: ReturnType<typeof useRuntimeApi>,
  refreshProviderAliases: () => Promise<void>,
  setPendingItem: (item: HistoryItemWithoutId | null) => void,
  updateHistoryTokenCount: (count: number) => void,
): SlashCommandProcessorState {
  const { reloadCommandsRef, reloadRegisteredCommands } =
    useRegisteredCommandReload();
  const extensionsCommand = useExtensionCommand(
    args.config,
    args.addItem,
    setPendingItem,
    args.actions.dispatchExtensionStateUpdate,
  );
  const state = useCommandState(
    args.settings,
    args.agent,
    args.addItem,
    useHistoryCommandOwners(
      args.agent,
      args.config,
      runtimeApi,
      args.settings,
      useOAuthControl(),
      args.loadHistory,
      args.addItem,
    ),
    args.setLlxprtMdFileCount,
    args.todoContext,
    reloadRegisteredCommands,
    refreshProviderAliases,
    args.recordingIntegration,
    args.recordingOwner,
    args.recordingSwapCallbacks,
    args.config,
    runtimeApi,
    extensionsCommand,
    {
      ...useHostCommands(args.config, args.settings, args.addItem),
      ...useUtilityCommands(args.config, args.settings, args.addItem),
      ...useResourceCommands(
        args.config,
        args.settings,
        args.addItem,
        setPendingItem,
      ),
      ...usePresentationCommands(
        args.agent,
        args.config,
        args.settings,
        runtimeApi,
        args.addItem,
        args.actions.setDebugMessage,
        updateHistoryTokenCount,
        args.clearItems,
        args.refreshStatic,
        args.settings.merged.ui.useAlternateBuffer === true &&
          !(args.config?.getScreenReader() ?? false),
        args.toggleVimEnabled,
        args.actions.toggleDebugProfiler,
      ),
    },
  );
  reloadCommandsRef.current = state.reloadCommands;
  return state;
}

export function useSlashCommandProcessorCore(
  args: UseSlashCommandProcessorCoreArgs,
): SlashCommandProcessorCoreResult {
  const api = useRuntimeApi();
  const refreshProviderAliases = useProviderAliasRefresh();
  const { oauthControl, cancellation, pending, session } =
    useCommandRuntimeState(args.addItem);
  const state = useRegisteredCommands(
    args,
    api,
    refreshProviderAliases,
    pending.setPendingItem,
    session.updateHistoryTokenCount,
  );
  const commandContext = useCommandContext({
    runtimeApi: api,
    refreshProviderAliases,
    oauthControl,
    config: args.config,
    agent: args.agent,
    settings: args.settings,
    ...useManagers(args.config, args.agent ?? undefined),
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
  );
  const handleSlashCommand = useCallback<
    SlashCommandProcessorCoreResult['handleSlashCommand']
  >(
    (...input) =>
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
