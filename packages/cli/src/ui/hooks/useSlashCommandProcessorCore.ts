/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createWorkspaceCommandOwners } from './workspaceCommandOwners.js';

import { bindDirectoryChangeRecording } from '../commands/directoryCommandHost.js';
import { bindCommandOwnerResume } from './commandOwnerResumeHost.js';
import {
  resumeOwnerSession,
  importOwnerSession,
} from '../utils/ownerSessionUi.js';
import {
  bindCommandHistoryLoader,
  bindResumedHistoryReplay,
} from './commandHistoryLoaderHost.js';
import { bindCommandRawResume } from './commandRawResumeHost.js';
import { performResume } from '../../services/performResume.js';
import { resolveEmojiFilterMode } from '../utils/iContentToHistoryItems.js';
import { bindCommandErrorRecorder } from './commandErrorRecorderHost.js';
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

function useWorkspaceRegistration(
  agent: Agent | null,
  config: CliUiRuntime | null,
  addItem: UseHistoryManagerReturn['addItem'],
  setMemoryFileCount: (count: number) => void,
  recordingOwner: 'agent' | 'raw' | undefined,
  rawRecording: RecordingIntegration | undefined,
) {
  const session = agent?.session;
  const client = agent?.agentClient;
  const directoryRecorder = useDirectoryRecorder(
    recordingOwner,
    session,
    rawRecording,
  );
  const conversationHistory = useConversationHistory(client);
  const tools = agent?.tools;
  const sessionClient = agent?.sessionClient;
  const hooks = agent?.hooks;
  const tasks = agent?.tasks;
  const policy = agent?.policy;
  const runImageOperation = useMemo(
    () => sessionClient?.runImageOperation.bind(sessionClient),
    [sessionClient],
  );
  const readRules = useMemo(() => policy?.getRules.bind(policy), [policy]);
  const listTools = useMemo(() => tools?.list.bind(tools) ?? null, [tools]);
  const workspaceCommands = useMemo(
    () =>
      createWorkspaceCommandOwners(
        config,
        listTools,
        (key) => agent?.getEphemeralSetting(key),
        (key, value) => agent?.setEphemeralSetting(key, value),
        addItem,
        setMemoryFileCount,
        async () => {
          await client?.setTools();
        },
        readAvailablePolicyRules(readRules),
        policy?.getDefaultDecision.bind(policy) ?? unavailablePolicyOwner,
        policy?.isNonInteractive.bind(policy) ?? unavailablePolicyOwner,
        hooks?.listHooks.bind(hooks) ?? null,
        hooks?.enable.bind(hooks) ?? unavailableHookOwner,
        hooks?.disable.bind(hooks) ?? unavailableHookOwner,
        hooks?.setDisabledHooks.bind(hooks) ?? unavailableHookOwner,
        tasks?.list.bind(tasks) ?? null,
        tasks?.listRunning.bind(tasks) ?? unavailableTaskOwner,
        tasks?.get.bind(tasks) ?? unavailableTaskOwner,
        tasks?.cancel.bind(tasks) ?? unavailableTaskOwner,
        client?.addDirectoryContext.bind(client) ?? unavailableSessionOwner,
        directoryRecorder,
        runImageOperation,
        conversationHistory,
      ),
    [
      config,
      agent,
      addItem,
      setMemoryFileCount,
      listTools,
      client,
      directoryRecorder,
      conversationHistory,
      hooks,
      tasks,
      policy,
      runImageOperation,
      readRules,
    ],
  );
  return workspaceCommands;
}

function useDirectoryRecorder(
  recordingOwner: 'agent' | 'raw' | undefined,
  session: Agent['session'] | undefined,
  rawRecording: RecordingIntegration | undefined,
) {
  return useMemo(
    () =>
      bindDirectoryChangeRecording(
        recordingOwner,
        session?.recordRecordingEvent.bind(session) ?? null,
        rawRecording?.recordDirectoriesChanged.bind(rawRecording),
      ),
    [recordingOwner, session, rawRecording],
  );
}

function useConversationHistory(client: Agent['agentClient'] | undefined) {
  return useCallback(
    () =>
      client?.hasChatInitialized() === true
        ? client.getChat().getHistory()
        : undefined,
    [client],
  );
}

function readAvailablePolicyRules(
  readRules: Agent['policy']['getRules'] | undefined,
) {
  return () => readRules?.() ?? null;
}

function unavailableHookOwner(): never {
  throw new Error('Hook owner unavailable');
}
function unavailableTaskOwner(): never {
  throw new Error('Task owner unavailable');
}
function unavailablePolicyOwner(): never {
  throw new Error('Policy owner unavailable');
}
function unavailableSessionOwner(): never {
  throw new Error('Session agent is unavailable');
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
    resumeOwnedSession:
      args.recordingOwner === 'agent'
        ? bindCommandOwnerResume((action) => {
            const agent = args.agent;
            if (agent === null) throw new Error('Session agent is unavailable');
            const mode = resolveEmojiFilterMode(args.config);
            return action.sessionPackage === undefined
              ? resumeOwnerSession(agent, action.sessionRef, mode)
              : importOwnerSession(
                  agent,
                  action.sessionPackage.packageDirectory,
                  mode,
                );
          }, args.loadHistory)
        : null,
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
    isMcpDiscoveryPending: () => args.agent?.mcp.discoveryState() === 'pending',
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
    resumeRawSession: bindCommandRawResume(
      args.config,
      args.config?.sessionPersistence,
      () => {
        if (!args.agent) throw new Error('Session agent is unavailable');
        return args.agent.agentClient.getHistoryService();
      },
      args.recordingSwapCallbacks,
      slashCommandLogger,
      performResume,
    ),
    replayResumedHistory: bindResumedHistoryReplay(
      () => resolveEmojiFilterMode(args.config),
      commandContext.ui.clear,
      args.addItem,
    ),
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

function useStaticBuiltinCommands(
  config: CliUiRuntime | null,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
  setPendingItem: ReturnType<typeof usePendingHistory>['setPendingItem'],
  dispatchExtensionStateUpdate: SlashCommandProcessorActions['dispatchExtensionStateUpdate'],
) {
  return {
    extensionsCommand: useExtensionCommand(
      config,
      addItem,
      setPendingItem,
      dispatchExtensionStateUpdate,
    ),
    ...useHostCommands(config, settings, addItem),
    ...useUtilityCommands(config, settings, addItem),
    ...useResourceCommands(config, settings, addItem, setPendingItem),
  };
}

function useBound<Owner, Args extends unknown[], Result>(
  owner: Owner,
  operation: (this: Owner, ...args: Args) => Result,
): (...args: Args) => Result {
  return useMemo(() => operation.bind(owner), [owner, operation]);
}

function useModelSelectionCommands(
  selectModel: Parameters<typeof useModelCommand>[0],
  readFormat: Parameters<typeof useToolFormatCommand>[0],
  writeFormat: Parameters<typeof useToolFormatCommand>[1],
  record: Parameters<typeof useModelCommand>[1],
) {
  return {
    modelCommand: useModelCommand(selectModel, record),
    toolFormatCommand: useToolFormatCommand(readFormat, writeFormat),
  };
}

function useBoundRegistry(
  builtins: BuiltinCommandOwners,
  config: CliUiRuntime | null,
  publishReload: (reload: () => void) => void,
): SlashCommandProcessorState {
  const state = useRegistryState(builtins, config);
  publishReload(state.reloadCommands);
  return { builtins, ...state };
}

function useRegisteredCommands(
  args: UseSlashCommandProcessorCoreArgs,
  runtimeApi: ReturnType<typeof useRuntimeApi>,
  refreshProviderAliases: () => Promise<void>,
  setPendingItem: (item: HistoryItemWithoutId | null) => void,
  presentationCommands: ReturnType<typeof usePresentationCommands>,
  historyCommandOwners: ReturnType<typeof useHistoryCommandOwners>,
): SlashCommandProcessorState {
  const { agent, config, settings, addItem, recordingOwner } = args;
  const { reloadCommandsRef, reloadRegisteredCommands } =
    useRegisteredCommandReload();
  const { extensionsCommand, ...staticCommands } = useStaticBuiltinCommands(
    config,
    settings,
    addItem,
    setPendingItem,
    args.actions.dispatchExtensionStateUpdate,
  );
  const rec = useSwitch(
    agent?.session,
    args.recordingIntegration,
    recordingOwner,
  );
  const { modelCommand, toolFormatCommand } = useModelSelectionCommands(
    useBound(runtimeApi, runtimeApi.setActiveModel),
    useBound(runtimeApi, runtimeApi.getActiveToolFormatState),
    useBound(runtimeApi, runtimeApi.setActiveToolFormatOverride),
    rec,
  );
  const provider = useProviderCommand(agent, refreshProviderAliases, rec);
  const credentialCommands = useCredentialCommands(
    agent,
    settings,
    config,
    rec,
    addItem,
    reloadRegisteredCommands,
  );
  const chatCommand = useChatCommand(
    agent,
    config,
    recordingOwner,
    args.recordingIntegration,
    args.recordingSwapCallbacks,
    useCallback(() => settings.merged.enableFuzzyFiltering ?? true, [settings]),
  );
  const workspaceCommands = useWorkspaceRegistration(
    agent,
    config,
    addItem,
    args.setLlxprtMdFileCount,
    recordingOwner,
    args.recordingIntegration,
  );
  const builtins = useBuiltinCommandOwners({
    chatCommand,
    continueCommand: useContinueCommandOwner(agent, config, recordingOwner),
    historyCommandOwners,
    modelCommand,
    toolFormatCommand,
    setCommand: useSetCommand(settings),
    provider,
    todoCommand: useTodoCommandOwner(args.todoContext, addItem),
    subagentCommand: useSubagentCommand(agent, config, settings, addItem),
    extensionsCommand,
    presentationCommands: { ...staticCommands, ...presentationCommands },
    ...workspaceCommands,
    credentialCommands,
  });
  return useBoundRegistry(builtins, config, (reload) => {
    reloadCommandsRef.current = reload;
  });
}

function useCommandHandler(
  deps: SlashCommandHandlerDeps,
): SlashCommandProcessorCoreResult['handleSlashCommand'] {
  return useCallback((...input) => processSlashCommand(deps, ...input), [deps]);
}

export function useSlashCommandProcessorCore(
  args: UseSlashCommandProcessorCoreArgs,
): SlashCommandProcessorCoreResult {
  const api = useRuntimeApi();
  const refreshProviderAliases = useProviderAliasRefresh();
  const { cancellation, pending, session } = useCommandRuntimeState(
    args.addItem,
  );
  const presentationCommands = usePresentationCommands(
    args.agent,
    args.config,
    args.settings,
    api,
    args.addItem,
    args.actions.setDebugMessage,
    session.updateHistoryTokenCount,
    args.clearItems,
    args.refreshStatic,
    args.settings.merged.ui.useAlternateBuffer === true &&
      !(args.config?.getScreenReader() ?? false),
    args.toggleVimEnabled,
    args.actions.toggleDebugProfiler,
  );

  const historyCommandOwners = useHistoryCommandOwners(
    args.agent,
    args.config,
    api,
    args.settings,
    useOAuthControl(),
    args.loadHistory,
    args.addItem,
  );
  const state = useRegisteredCommands(
    args,
    api,
    refreshProviderAliases,
    pending.setPendingItem,
    presentationCommands,
    historyCommandOwners,
  );
  const commandContext = useCommandContext({
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
  const handleSlashCommand = useCommandHandler(
    buildHandlerDeps(args, state, pending, commandContext, cancellation),
  );
  return {
    handleSlashCommand,
    slashCommands: state.commands,
    pendingHistoryItems: pending.pendingHistoryItems,
    commandContext,
    cancelActiveSlashCommand: cancellation.cancelActiveSlashCommand,
  };
}
