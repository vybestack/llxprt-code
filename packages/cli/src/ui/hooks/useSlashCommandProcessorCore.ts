import {
  useOwnedChatOperations,
  useRawChatOperations,
  useRawChatHistory,
  useCurrentChatRecording,
  useChatProjectHash,
} from './useChatOperations.js';
import { useContinueCommand } from './useContinueCommand.js';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createWorkspaceCommandOwners } from './workspaceCommandOwners.js';

import { bindDirectoryChangeRecording } from '../commands/directoryCommandHost.js';
import { bindCommandOwnerResume } from './commandOwnerResumeHost.js';
import { importOwnerSession } from '../utils/ownerSessionUi.js';
import { resumeOwnerSession } from '../utils/resumeOwnerSession.js';
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
import { useSetCommand } from './useSetCommand.js';
import { useCredentialCommands } from './useCredentialCommands.js';
import { useChatCommand } from './useChatCommand.js';
import { useBuiltinCommandOwners } from './useBuiltinCommandOwners.js';
import { basename } from 'node:path';
import { useExtensionCommand } from './useExtensionCommand.js';
import { useSubagentCommand } from './useSubagentCommand.js';
import { bindAutoPromptOperation } from '../commands/subagentCommandHost.js';
import { createTodoCommand } from '../commands/todoCommand.js';
import type { DialogStore } from '../stores/dialog/dialogStore.js';
import type {
  RecordingIntegration,
  Todo,
  AgentRequestInput,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
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

function bindOwnedCommandResume(
  args: UseSlashCommandProcessorCoreArgs,
): SlashCommandHandlerDeps['resumeOwnedSession'] {
  return args.recordingOwner === 'agent'
    ? bindCommandOwnerResume((action) => {
        const agent = args.agent;
        if (agent === null) throw new Error('Session agent is unavailable');
        const mode = resolveEmojiFilterMode(args.config);
        return action.sessionPackage === undefined
          ? resumeOwnerSession(
              agent.session.resume.bind(agent.session),
              action.sessionRef,
              mode,
              agent.session.listBrowserTargetsDetailed.bind(agent.session),
            )
          : importOwnerSession(
              agent.session.importSession.bind(agent.session),
              action.sessionPackage.packageDirectory,
              mode,
              agent.session.getHistory.bind(agent.session),
            );
      }, args.loadHistory)
    : null;
}

function buildHandlerDeps(
  args: UseSlashCommandProcessorCoreArgs,
  state: SlashCommandProcessorState,
  pending: ReturnType<typeof usePendingHistory>,
  commandContext: ReturnType<typeof useCommandContext>,
  cancellation: SlashCommandCancellation,
): SlashCommandHandlerDeps {
  return {
    resumeOwnedSession: bindOwnedCommandResume(args),
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
      args.agent === null
        ? null
        : args.agent.session.recordRecordingEvent.bind(args.agent.session),
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

function useBoundRegistry(
  builtins: BuiltinCommandOwners,
  config: CliUiRuntime | null,
  reloadRef: React.MutableRefObject<() => void>,
): SlashCommandProcessorState {
  const state = useRegistryState(builtins, config);
  reloadRef.current = state.reloadCommands;
  return { builtins, ...state };
}

function useRegisteredCommands(
  args: UseSlashCommandProcessorCoreArgs,
  presentationCommands: ReturnType<typeof usePresentationCommands>,
  historyCommandOwners: ReturnType<typeof useHistoryCommandOwners>,
  providerCommands: ReturnType<typeof useCredentialCommands>,
  setPendingItem: (item: HistoryItemWithoutId | null) => void,
  reloadCommandsRef: React.MutableRefObject<() => void>,
): SlashCommandProcessorState {
  const { agent, config, settings, recordingOwner } = args;
  const fuzzy = useFuzzyPreference(settings);
  const { extensionsCommand, ...staticCommands } = useStaticBuiltinCommands(
    config,
    settings,
    args.addItem,
    setPendingItem,
    args.actions.dispatchExtensionStateUpdate,
  );

  const { session, agentClient: chatClient } = agent ?? {};
  const raw = args.recordingIntegration;
  const swaps = args.recordingSwapCallbacks;
  const ownerChat = useOwnedChatOperations(
    session,
    useBound(agent, agent?.getModel ?? missingChatOwner),
    useCallback(() => resolveEmojiFilterMode(config), [config]),
  );
  const history = useRawChatHistory(chatClient);
  const rawChat = useRawChatOperations(
    useCurrentChatRecording(
      useBound(swaps, swaps?.getCurrentRecording ?? readNull),
      useBound(raw, raw?.getRecordingService ?? readNull),
    ),
    useChatProjectHash(useBound(config, config?.getProjectRoot ?? readNull)),
    useCallback(() => config?.projectChatsDir ?? null, [config]),
    history.getMediaStore,
    history.getChatHistory,
    history.replaceChatHistory,
    useCallback(() => (config ? config.getModel() : null), [config]),
  );
  const workspaceCommands = useWorkspaceRegistration(
    agent,
    config,
    args.addItem,
    args.setLlxprtMdFileCount,
    recordingOwner,
    args.recordingIntegration,
  );
  const builtins = useBuiltinCommandOwners({
    chatCommand: useChatCommand(ownerChat, rawChat, recordingOwner, fuzzy),
    continueCommand: useContinueCommand(
      useBound(session, session?.exportSession ?? missingSession),
      useCallback(() => config?.isInteractive() === true, [config]),
      useBound(session, session?.listBrowserTargets ?? missingSession),
      useCallback(() => config?.projectChatsDir ?? null, [config]),
      useCallback(
        () => (config ? basename(config.projectTempDir) : null),
        [config],
      ),
      chatClient?.mediaStore,
      recordingOwner,
    ),
    historyCommandOwners,
    setCommand: useSetCommand(settings),
    todoCommand: useTodoCommandOwner(args.todoContext, args.addItem),
    subagentCommand: useSubagentCommand(
      agent?.workspace.subagentDefinitions,
      agent?.workspace.subagentWrites,
      useSubagentProfileCatalog(agent?.workspace.profileDefinitions),
      fuzzy,
      useMemo(() => bindAutoPromptOperation(agent, config), [agent, config]),
      config !== null,
      args.addItem,
    ),
    extensionsCommand,
    presentationCommands: { ...staticCommands, ...presentationCommands },
    ...workspaceCommands,
    credentialCommands: providerCommands,
  });
  return useBoundRegistry(builtins, config, reloadCommandsRef);
}

function useCommandHandler(
  deps: SlashCommandHandlerDeps,
): SlashCommandProcessorCoreResult['handleSlashCommand'] {
  return useCallback((...input) => processSlashCommand(deps, ...input), [deps]);
}

export function useSlashCommandProcessorCore(
  args: UseSlashCommandProcessorCoreArgs,
): SlashCommandProcessorCoreResult {
  const {
    agent,
    config,
    settings,
    recordingIntegration,
    recordingOwner,
    recordingSwapCallbacks: _recordingSwapCallbacks,
    ...invocation
  } = args;
  const api = useRuntimeApi();
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
  const { reloadCommandsRef, reloadRegisteredCommands } =
    useRegisteredCommandReload();
  const providerCommands = useCredentialCommands(
    agent,
    settings,
    config,
    recordingIntegration,
    recordingOwner,
    invocation.addItem,
    reloadRegisteredCommands,
    useProviderAliasRefresh(),
  );
  const state = useRegisteredCommands(
    args,
    presentationCommands,
    historyCommandOwners,
    providerCommands,
    pending.setPendingItem,
    reloadCommandsRef,
  );
  useCommandReload(
    state.builtins,
    args.config,
    state.reloadTrigger,
    args.isConfigInitialized,
    state.reloadCommands,
    state.setCommands,
    args.agent,
  );
  return useCommandView(
    invocation,
    settings.merged.ui.useAlternateBuffer === true &&
      !(config?.getScreenReader() ?? false),
    state,
    pending,
    session,
    cancellation,
    (context) => buildHandlerDeps(args, state, pending, context, cancellation),
  );
}

function missingChatOwner(): never {
  throw new Error('No session owner available');
}

function missingSession(): never {
  throw new Error('Session agent is unavailable');
}

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

function useCommandView(
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

function readNull(): null {
  return null;
}

function useFuzzyPreference(
  settings: Pick<LoadedSettings, 'merged'>,
): () => boolean {
  return useCallback(
    () => settings.merged.enableFuzzyFiltering !== false,
    [settings],
  );
}

function useSubagentProfileCatalog(
  profiles: Agent['workspace']['profileDefinitions'] | undefined,
): () => Promise<string[]> {
  return useCallback(
    () => profiles?.listProfiles() ?? Promise.resolve([]),
    [profiles],
  );
}
