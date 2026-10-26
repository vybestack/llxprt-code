/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ReadBuiltinCommands,
  LoadRegisteredCommands,
  SubscribeCommandChanges,
} from '../../services/commandRegistryOperations.js';

import {
  useHistoryRegistration,
  type HistoryRegistrationRuntime,
  type RegisteredHistoryReads,
} from './useRegisteredHistoryCommands.js';

import {
  type GetLoadBalancerStatsOperation,
  type GetLoadBalancerTokenAccountingOperation,
  type GetProviderDumpMetadataOperation,
  type GetRuntimeDiagnosticsSnapshotOperation,
  type GetSessionSettingOperation,
  type GetSessionTokenUsageOperation,
  type ProviderStatusOperation,
  type SetSessionSettingOperation,
  useGetActiveProviderDetails,
  useGetActiveProviderName,
  useGetEphemeralSetting,
  useGetLoadBalancerStats,
  useGetLoadBalancerTokenAccounting,
  useGetProviderDumpMetadata,
  useGetRuntimeDiagnosticsSnapshot,
  useGetSessionSetting,
  useGetSessionTokenUsage,
  useProviderStatus,
  useSetSessionSetting,
} from '../contexts/RuntimeContext.js';

import { useCommandView } from './useCommandView.js';

import { bindCommandOwnerResume } from './commandOwnerResumeHost.js';
import {
  bindCommandHistoryLoader,
  bindResumedHistoryReplay,
} from './commandHistoryLoaderHost.js';
import type {
  ResumeSessionReads,
  bindCommandRawResume,
} from './commandRawResumeHost.js';
import { resolveEmojiFilterMode } from '../utils/iContentToHistoryItems.js';
import { bindCommandErrorRecorder } from './commandErrorRecorderHost.js';
import type { useHistoryCommandOwners } from './useHistoryCommandOwners.js';
import { useOAuthControl } from '../contexts/OAuthControlContext.js';
import { useCommandRuntimeState } from './useCommandRuntimeState.js';
import { useRegisteredCommandReload } from './useRegisteredCommandReload.js';
import { useHostCommands } from './useHostCommands.js';
import { useResourceCommands } from './useResourceCommands.js';
import { useUtilityCommands } from './useUtilityCommands.js';
import { usePresentationCommands } from './usePresentationCommands.js';
import { bindDiagnosticsReads } from '../commands/diagnosticsCommandHost.js';

import { bindAboutDetails } from '../commands/aboutCommandHost.js';
import type { ExtensionsCommandRuntime } from '../commands/extensionsCommandHost.js';
import type { HostCommandsRuntime } from './useHostCommands.js';
import type { PermissionsTrustRuntime } from '../commands/permissionsCommandHost.js';
import type { LoggingCommandRuntime } from '../commands/loggingCommandHost.js';
import type { SkillsCommandRuntime } from './useResourceCommands.js';
import type { DiagnosticsCommandRuntime } from '../commands/diagnosticsCommandHost.js';
import type { EmojiFilterSettingsSource } from '../utils/iContentToHistoryItems.js';
import type { CliSessionPersistencePort } from '../../cliSessionPersistence.js';
import { useCallback, useMemo, useState } from 'react';
import { useSetCommand } from './useSetCommand.js';
import type { CredentialCommandRegistration } from './credentialCommandRegistration.js';
import type { CredentialCommands } from './credentialCommandTypes.js';
import { useBuiltinCommandOwners } from './useBuiltinCommandOwners.js';
import { useExtensionCommand } from './useExtensionCommand.js';
import { createTodoCommand } from '../commands/todoCommand.js';
import type { DialogStore } from '../stores/dialog/dialogStore.js';
import type {
  RecordingIntegration,
  Todo,
  AgentRequestInput,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type {
  RegisterWorkspaceCommands,
  RegisterChatCommands,
  RegisterSubagentCommand,
  ResumeOwnedCommand,
  EndCommandSession,
  StartNewCommandSession,
  StartCommandSession,
} from './commandSessionOperations.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { RecordingSwapCallbacks } from '../../services/performResume.js';

import type {
  HistoryItemWithoutId,
  SlashCommandProcessorResult,
} from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';
import type { SlashCommand } from '../commands/types.js';
import type { ExtensionUpdateState } from '../state/extensions.js';
import { type SlashCommandHandlerDeps } from './slashCommandHandlers.js';
import {
  confirmationLogger,
  slashCommandLogger,
  type SlashCommandProcessorActions,
} from './slashCommandProcessor.js';
import type { BuiltinCommandOwners } from '../../services/BuiltinCommandLoader.js';
import {
  type useCommandContext,
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

/** Provider and model identity the about view prints. */
export interface AboutDetailsRuntime {
  getModel(): string;
  getProvider(): string | undefined;
  getEphemeralSetting(key: string): unknown;
}

/** Session identity plus the persistence a raw-recording resume binds. */
export interface CommandResumeRuntime extends ResumeSessionReads {
  readonly sessionPersistence?: Pick<
    CliSessionPersistencePort,
    'resumeRecording'
  >;
}

/**
 * The collaborators this processor binds, one field per command family it
 * registers. Each field is the port that family reads; the processor never
 * receives the CLI runtime itself.
 */
export interface SlashCommandProcessorPorts {
  /** Extension state /extensions lists and restarts. */
  readonly extensions: ExtensionsCommandRuntime | null;
  /** Working directory and proxy the host commands print. */
  readonly hosts: HostCommandsRuntime | null;
  /** Folder trust the permissions commands read and update. */
  readonly trust: PermissionsTrustRuntime | null;
  /** Telemetry and logging settings /logging reads and writes. */
  readonly logging: LoggingCommandRuntime | null;
  /** Skill operations /skills reads; undefined without a skill manager. */
  readonly skills: SkillsCommandRuntime | undefined;
  /** Emoji filter mode history replay resolves. */
  readonly emojiFilter: EmojiFilterSettingsSource | null;
  /** Per-command telemetry logging; its presence means logging is wired. */
  readonly commandLogging: SlashCommandHandlerDeps['config'];
  /** Provider/model identity the about view prints. */
  readonly about: AboutDetailsRuntime | null;
  /** Runtime diagnostics /diagnostics prints. */
  readonly diagnostics: DiagnosticsCommandRuntime | null;
  /** Perf snapshot, token directory and checkpoint state for the history owners. */
  readonly history: HistoryRegistrationRuntime | null;
  /** Screen-reader flag guarding the alternate buffer. */
  readonly readScreenReader: () => boolean;
  /** Directory the presentation commands name. */
  readonly readTargetDir: () => string | undefined;
  /** Session identity and persistence for raw-recording resume. */
  readonly resumeSession: CommandResumeRuntime | null;
}

export interface UseSlashCommandProcessorCoreArgs
  extends RegisteredHistoryReads {
  ports: SlashCommandProcessorPorts;
  registerIdeCommand: Parameters<typeof useHostCommands>[3];
  readIdeDisplayName: () => string;
  readIdeMode: () => boolean;
  readIdeAvailable: () => boolean;
  registerWorkspaceCommands: RegisterWorkspaceCommands;
  registerChatCommands: RegisterChatCommands;
  registerSubagentCommand: RegisterSubagentCommand;
  resumeOwnedCommand: ResumeOwnedCommand;
  replaceCommandHistory: Agent['setHistory'];
  bindRawCommandResume: (
    config: CommandResumeRuntime | null,
    callbacks: RecordingSwapCallbacks | undefined,
  ) => ReturnType<typeof bindCommandRawResume>;
  recordCommandEvent: Agent['session']['recordRecordingEvent'] | null;
  isMcpDiscoveryPending: () => boolean;
  endCommandSession: EndCommandSession;
  startNewCommandSession: StartNewCommandSession;
  startCommandSession: StartCommandSession;
  listCommandTools: Agent['tools']['list'];
  registerCredentials: CredentialCommandRegistration;
  readBuiltinCommands: ReadBuiltinCommands;
  loadRegisteredCommands: LoadRegisteredCommands;
  subscribeCommandChanges: SubscribeCommandChanges;
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

export interface SlashCommandProcessorState {
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

function useRegistryState(
  builtins: BuiltinCommandOwners,
  readBuiltins: ReadBuiltinCommands,
): Omit<SlashCommandProcessorState, 'builtins'> {
  const [commands, setCommands] = useState<readonly SlashCommand[] | undefined>(
    () =>
      process.env.LLXPRT_CODE_BUILTIN_COMMANDS_ONLY === 'true'
        ? readBuiltins(builtins)
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
    ? bindCommandOwnerResume(args.resumeOwnedCommand, args.loadHistory)
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
      args.replaceCommandHistory,
      () => resolveEmojiFilterMode(args.ports.emojiFilter),
      commandContext.ui.clear,
      args.addItem,
    ),
    recordCommandError: bindCommandErrorRecorder(
      args.recordCommandEvent,
      args.recordingOwner,
      args.recordingIntegration,
    ),
    isMcpDiscoveryPending: args.isMcpDiscoveryPending,
    commands: state.commands,
    config: args.ports.commandLogging,
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
    resumeRawSession: args.bindRawCommandResume(
      args.ports.resumeSession,
      args.recordingSwapCallbacks,
    ),
    replayResumedHistory: bindResumedHistoryReplay(
      () => resolveEmojiFilterMode(args.ports.emojiFilter),
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
  ports: SlashCommandProcessorPorts,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
  setPendingItem: ReturnType<typeof usePendingHistory>['setPendingItem'],
  dispatchExtensionStateUpdate: SlashCommandProcessorActions['dispatchExtensionStateUpdate'],
  registerIdeCommand: UseSlashCommandProcessorCoreArgs['registerIdeCommand'],
  subscribeCommandChanges: SubscribeCommandChanges,
) {
  return {
    extensionsCommand: useExtensionCommand(
      ports.extensions,
      addItem,
      setPendingItem,
      dispatchExtensionStateUpdate,
    ),
    ...useHostCommands(
      ports.hosts,
      ports.trust,
      addItem,
      registerIdeCommand,
      subscribeCommandChanges,
    ),
    ...useUtilityCommands(ports.logging, settings, addItem),
    ...useResourceCommands(ports.skills, settings, addItem, setPendingItem),
  };
}

function useBoundRegistry(
  builtins: BuiltinCommandOwners,
  readBuiltins: ReadBuiltinCommands,
  reloadRef: React.MutableRefObject<() => void>,
): SlashCommandProcessorState {
  const state = useRegistryState(builtins, readBuiltins);
  reloadRef.current = state.reloadCommands;
  return { builtins, ...state };
}

function useRegisteredCommands(
  args: UseSlashCommandProcessorCoreArgs,
  presentationCommands: ReturnType<typeof usePresentationCommands>,
  historyCommandOwners: ReturnType<typeof useHistoryCommandOwners>,
  providerCommands: CredentialCommands,
  setPendingItem: (item: HistoryItemWithoutId | null) => void,
  reloadCommandsRef: React.MutableRefObject<() => void>,
): SlashCommandProcessorState {
  const {
    ports,
    settings,
    recordingOwner,
    registerWorkspaceCommands,
    registerChatCommands,
    registerSubagentCommand,
    addItem,
    setLlxprtMdFileCount,
    recordingIntegration,
    recordingSwapCallbacks,
    readBuiltinCommands,
  } = args;
  const fuzzy = useFuzzyPreference(settings);
  const { extensionsCommand, ...staticCommands } = useStaticBuiltinCommands(
    ports,
    settings,
    args.addItem,
    setPendingItem,
    args.actions.dispatchExtensionStateUpdate,
    args.registerIdeCommand,
    args.subscribeCommandChanges,
  );

  const workspaceCommands = useMemo(
    () =>
      registerWorkspaceCommands(
        addItem,
        setLlxprtMdFileCount,
        recordingOwner,
        recordingIntegration,
      ),
    [
      registerWorkspaceCommands,
      addItem,
      setLlxprtMdFileCount,
      recordingOwner,
      recordingIntegration,
    ],
  );
  const chatCommands = useMemo(
    () =>
      registerChatCommands(
        recordingOwner,
        recordingIntegration,
        recordingSwapCallbacks,
        fuzzy,
      ),
    [
      registerChatCommands,
      recordingOwner,
      recordingIntegration,
      recordingSwapCallbacks,
      fuzzy,
    ],
  );
  const subagentCommand = useMemo(
    () => registerSubagentCommand(fuzzy, addItem),
    [registerSubagentCommand, fuzzy, addItem],
  );
  const builtins = useBuiltinCommandOwners({
    ...chatCommands,
    historyCommandOwners,
    setCommand: useSetCommand(settings),
    todoCommand: useTodoCommandOwner(args.todoContext, args.addItem),
    subagentCommand,
    extensionsCommand,
    presentationCommands: { ...staticCommands, ...presentationCommands },
    ...workspaceCommands,
    credentialCommands: providerCommands,
  });
  return useBoundRegistry(builtins, readBuiltinCommands, reloadCommandsRef);
}

function useAboutDetails(
  about: AboutDetailsRuntime | null,
  settings: LoadedSettings,
  readIdeDisplayName: () => string,
) {
  const readProviderDetails = useGetActiveProviderDetails();
  const readProviderName = useGetActiveProviderName();
  const readEphemeral = useGetEphemeralSetting();
  const readDiagnostics = useGetRuntimeDiagnosticsSnapshot();
  const readProviderStatus = useProviderStatus();
  return useMemo(
    () =>
      bindAboutDetails(
        readDiagnostics,
        readProviderName,
        readProviderDetails,
        readEphemeral,
        () => about?.getModel(),
        (key) => about?.getEphemeralSetting(key),
        () => about?.getProvider(),
        readIdeDisplayName,
        readProviderStatus,
        settings.getProviderKeyfile.bind(settings),
      ),
    [
      readIdeDisplayName,
      readProviderDetails,
      readProviderName,
      readEphemeral,
      readDiagnostics,
      readProviderStatus,
      about,
      settings,
    ],
  );
}

export function useSlashCommandProcessorCore(
  args: UseSlashCommandProcessorCoreArgs,
): SlashCommandProcessorCoreResult {
  const {
    ports,
    settings,
    recordingIntegration: _recordingIntegration,
    recordingOwner: _recordingOwner,
    recordingSwapCallbacks: _recordingSwapCallbacks,
    ...invocation
  } = args;
  const readBalancerStats = useGetLoadBalancerStats();
  const readBalancerTokens = useGetLoadBalancerTokenAccounting();
  const readDumpProvider = useGetProviderDumpMetadata();
  const readDiagnostics = useGetRuntimeDiagnosticsSnapshot();
  const readSessionSetting = useGetSessionSetting();
  const readSessionTokens = useGetSessionTokenUsage();
  const readProviderStatus = useProviderStatus();
  const writeSessionSetting = useSetSessionSetting();
  const oauth = useOAuthControl();
  const alternateBuffer =
    settings.merged.ui.useAlternateBuffer === true && !ports.readScreenReader();
  const { cancellation, pending, session } = useCommandRuntimeState(
    args.addItem,
  );
  const presentationCommands = usePresentationCommands(
    useAboutDetails(ports.about, settings, args.readIdeDisplayName),
    ports.readTargetDir(),
    args.endCommandSession,
    args.startNewCommandSession,
    args.startCommandSession,
    args.addItem,
    args.actions.setDebugMessage,
    session.updateHistoryTokenCount,
    args.clearItems,
    args.refreshStatic,
    alternateBuffer,
    args.toggleVimEnabled,
    args.actions.toggleDebugProfiler,
  );

  const state = useProcessorRegistration(
    args,
    readBalancerStats,
    readBalancerTokens,
    readDumpProvider,
    readDiagnostics,
    readSessionSetting,
    readSessionTokens,
    readProviderStatus,
    writeSessionSetting,
    oauth,
    presentationCommands,
    pending.setPendingItem,
  );
  useCommandReload(
    state.builtins,
    args.loadRegisteredCommands,
    args.subscribeCommandChanges,
    state.reloadTrigger,
    args.isConfigInitialized,
    state.reloadCommands,
    state.setCommands,
  );
  return useCommandView(
    invocation,
    alternateBuffer,
    state,
    pending,
    session,
    cancellation,
    (context) => buildHandlerDeps(args, state, pending, context, cancellation),
  );
}

function useFuzzyPreference(
  settings: Pick<LoadedSettings, 'merged'>,
): () => boolean {
  return useCallback(
    () => settings.merged.enableFuzzyFiltering !== false,
    [settings],
  );
}

function useProcessorRegistration(
  args: UseSlashCommandProcessorCoreArgs,
  readBalancerStats: GetLoadBalancerStatsOperation,
  readBalancerTokens: GetLoadBalancerTokenAccountingOperation,
  readDumpProvider: GetProviderDumpMetadataOperation,
  readDiagnostics: GetRuntimeDiagnosticsSnapshotOperation,
  readSessionSetting: GetSessionSettingOperation,
  readSessionTokens: GetSessionTokenUsageOperation,
  readProviderStatus: ProviderStatusOperation,
  writeSessionSetting: SetSessionSettingOperation,
  oauth: ReturnType<typeof useOAuthControl>,
  presentationCommands: ReturnType<typeof usePresentationCommands>,
  setPendingItem: ReturnType<typeof usePendingHistory>['setPendingItem'],
): SlashCommandProcessorState {
  const {
    ports,
    settings,
    recordingIntegration,
    recordingOwner,
    registerCredentials,
    addItem,
  } = args;
  const { reloadCommandsRef, reloadRegisteredCommands } =
    useRegisteredCommandReload();
  const listTools = args.listCommandTools;

  return useRegisteredCommands(
    args,
    presentationCommands,
    useHistoryRegistration(
      useDiagnosticsRegistration(
        listTools,
        ports.diagnostics,
        settings,
        readBalancerStats,
        readBalancerTokens,
        readDiagnostics,
        readSessionTokens,
        readProviderStatus,
        oauth,
        args.readIdeMode,
        args.readIdeAvailable,
      ),
      ports.history,
      settings,
      args.loadHistory,
      args.addItem,
      args.compressHistory,
      args.readRawHistory,
      args.isHistoryInitialized,
      args.readHistory,
      args.replaceHistory,
      readSessionSetting,
      writeSessionSetting,
      args.readDumpHistory,
      readDumpProvider,
    ),
    useCredentialRegistry(
      registerCredentials,
      addItem,
      reloadRegisteredCommands,
      recordingIntegration,
      recordingOwner,
    ),
    setPendingItem,
    reloadCommandsRef,
  );
}

function useCredentialRegistry(
  register: CredentialCommandRegistration,
  addItem: UseHistoryManagerReturn['addItem'],
  reload: () => void,
  raw: RecordingIntegration | undefined,
  owner: 'agent' | 'raw' | undefined,
): CredentialCommands {
  return useMemo(
    () => register(addItem, reload, raw, owner),
    [register, addItem, reload, raw, owner],
  );
}

function useDiagnosticsRegistration(
  listTools: Agent['tools']['list'],
  config: DiagnosticsCommandRuntime | null,
  settings: LoadedSettings,
  readBalancerStats: GetLoadBalancerStatsOperation,
  readBalancerTokens: GetLoadBalancerTokenAccountingOperation,
  readDiagnostics: GetRuntimeDiagnosticsSnapshotOperation,
  readSessionTokens: GetSessionTokenUsageOperation,
  readProviderStatus: ProviderStatusOperation,
  oauth: ReturnType<typeof useOAuthControl>,
  readIdeMode: () => boolean,
  readIdeAvailable: () => boolean,
) {
  return useMemo(
    () =>
      bindDiagnosticsReads(
        config,
        settings,
        listTools,
        readBalancerStats,
        readBalancerTokens,
        readDiagnostics,
        readSessionTokens,
        readProviderStatus,
        oauth,
        readIdeMode,
        readIdeAvailable,
      ),
    [
      listTools,
      config,
      settings,
      readBalancerStats,
      readBalancerTokens,
      readDiagnostics,
      readSessionTokens,
      readProviderStatus,
      oauth,
      readIdeMode,
      readIdeAvailable,
    ],
  );
}
