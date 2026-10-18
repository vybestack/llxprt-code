/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ReadBuiltinCommands,
  LoadRegisteredCommands,
  SubscribeCommandChanges,
} from '../services/commandRegistryOperations.js';

import type { RegisteredHistoryReads } from './hooks/useRegisteredHistoryCommands.js';

import type { CredentialCommandRegistration } from './hooks/credentialCommandRegistration.js';

import {
  useGetActiveModelName,
  useGetActiveProfileName,
  useGetActiveProviderName,
  useGetLoadBalancerStats,
  useHasActiveProvider,
  useListAvailableModels,
  useListProviders,
  useListSavedProfiles,
  useLoadProfileByName,
  useProviderStatus,
  useSaveProfileSnapshot,
  useSetActiveModel,
  useSetDefaultProfileName,
  useSetProvider,
  useUpdateActiveProviderApiKey,
} from './contexts/RuntimeContext.js';
import { resolveEmojiFilterMode } from './utils/iContentToHistoryItems.js';
import { useBootstrapRuntime } from './containers/AppContainer/hooks/useBootstrapRuntime.js';
import {
  useRecordingInfrastructure,
  type UseRecordingInfrastructureResult,
} from './containers/AppContainer/hooks/useRecordingInfrastructure.js';
import { useExtensionAutoUpdate } from './hooks/useExtensionAutoUpdate.js';

import type React from 'react';
import type {
  MessageBus,
  RecordingIntegration,
  SessionRecordingService,
  LockHandle,
  IContent,
} from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type { SessionMetricUpdates } from '@vybestack/llxprt-code-telemetry';
import type { SlashCommandRuntime, UiRuntime } from './cliUiRuntime.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../config/settings.js';
import type { AppState, AppAction } from './reducers/appReducer.js';
import type { OperationLifecycleRegistry } from './hooks/agentStream/operationLifecycle.js';
import type { MemoryTelemetryController } from './hooks/memoryTrend/memoryTelemetry.js';
import {
  DefaultAppLayout,
  type DefaultAppLayoutProps,
} from './layouts/DefaultAppLayout.js';
import type {
  AppBootstrapProps,
  AppBootstrapResult,
} from './containers/AppContainer/hooks/useAppBootstrap.js';
import { useAppDialogs } from './containers/AppContainer/hooks/useAppDialogs.js';
import type {
  AppDialogsParams,
  AppDialogsResult,
} from './containers/AppContainer/hooks/useAppDialogs.js';
import { useAppInput } from './containers/AppContainer/hooks/useAppInput.js';
import type {
  AppInputParams,
  AppInputResult,
} from './containers/AppContainer/hooks/useAppInput.js';
import { useAppLayout } from './containers/AppContainer/hooks/useAppLayout.js';
import { useAppCommands } from './appCommandBindings.js';
import { useUnconfiguredProviderGuidance } from './hooks/useUnconfiguredProviderGuidance.js';
import {
  createDialogStore,
  type DialogStore,
} from './stores/dialog/dialogStore.js';
import {
  createDialogOpeners,
  type DialogOpeners,
} from './stores/dialog/dialogOpeners.js';
import { DialogProvider } from './stores/dialog/DialogContext.js';
import {
  createTerminalStore,
  type TerminalStore,
} from './stores/terminal/terminalStore.js';
import { TerminalProvider } from './stores/terminal/TerminalContext.js';
import { createTurnStore, type TurnStore } from './stores/turn/turnStore.js';
import { TurnProvider } from './stores/turn/TurnContext.js';
import {
  createSettingsProfileStore,
  type SettingsProfileStore,
} from './stores/settings/settingsStore.js';
import { SettingsProfileProvider } from './stores/settings/SettingsContext.js';
import {
  AppCommandsProvider,
  type AppCommandBindings,
} from './contexts/AppCommandsContext.js';
import { ToolResultExpansionProvider } from './contexts/ToolResultExpansionContext.js';
import { useRef, useMemo, useCallback } from 'react';
import { useBound } from './hooks/agentStream/useStreamOwnerCallbacks.js';
import { useBrowserCatalogCommands } from './hooks/useBrowserCatalogCommands.js';
import {
  bindOwnerBrowserResume,
  bindRawBrowserResume,
  bindRawBrowserSession,
} from './components/browserResumeHost.js';
import { resumeOwnerSession } from './utils/resumeOwnerSession.js';
import { useVimMode } from './contexts/VimModeContext.js';
import { useTodoContext } from './contexts/TodoContext.js';
import { useExtensionUpdates } from './hooks/useExtensionUpdates.js';
import { useSlashCommandActions } from './containers/AppContainer/hooks/useSlashCommandActions.js';
import { useStoreSelector } from './stores/useStoreSelector.js';
import type {
  SlashCommandProcessorCoreResult,
  UseSlashCommandProcessorCoreArgs,
} from './hooks/useSlashCommandProcessorCore.js';
import { useSlashCommandProcessorCore } from './hooks/useSlashCommandProcessorCore.js';
import type { HistoryItem } from './types.js';
import {
  useInputAgentOperations,
  useInputStreamPolicy,
} from './inputOwnerBindings.js';
import { getInteractiveTranscriptPath } from './transcriptPath.js';

const debug = new DebugLogger('llxprt:ui:appcontainer');

export interface AppContainerRuntimeProps
  extends Pick<
    UseSlashCommandProcessorCoreArgs,
    | 'registerWorkspaceCommands'
    | 'registerChatCommands'
    | 'registerSubagentCommand'
    | 'resumeOwnedCommand'
    | 'replaceCommandHistory'
    | 'readCommandHistoryService'
    | 'recordCommandEvent'
    | 'isMcpDiscoveryPending'
    | 'endCommandSession'
    | 'startNewCommandSession'
    | 'startCommandSession'
    | 'listCommandTools'
  > {
  triggerSessionStart: AppBootstrapProps['triggerSessionStart'];
  appendHistory: AppBootstrapProps['appendHistory'];
  recordRecordingEvent: AppBootstrapProps['recordRecordingEvent'];
  metrics: SessionMetricUpdates;
  readTokenHistory: () => ReturnType<
    Agent['agentClient']['getHistoryService']
  > | null;
  readProviderMetrics: AppBootstrapProps['readProviderMetrics'];
  readSessionTokenUsage: AppBootstrapProps['readSessionTokenUsage'];
  historyReads: RegisteredHistoryReads;
  registerCredentials: CredentialCommandRegistration;
  readBuiltinCommands: ReadBuiltinCommands;
  loadRegisteredCommands: LoadRegisteredCommands;
  subscribeCommandChanges: SubscribeCommandChanges;
  uiRuntime: UiRuntime;
  slashCommandRuntime: SlashCommandRuntime;
  session: Parameters<typeof useInputBrowserCommands>[0] &
    Parameters<typeof useInputAgentOperations>[10];
  mediaStore: Parameters<typeof useInputBrowserCommands>[4];
  readClientHistory: Parameters<typeof useInputBrowserCommands>[5];
  readHistory: Parameters<typeof useInputAgentOperations>[0];
  stream: Parameters<typeof useInputAgentOperations>[1];
  injectSteer: Parameters<typeof useInputAgentOperations>[3];
  getProviderContextLimit: Parameters<typeof useInputAgentOperations>[4];
  getContentPrefixIdentity: Parameters<typeof useInputAgentOperations>[5];
  tools: Parameters<typeof useInputAgentOperations>[6];
  mcp: Parameters<typeof useInputAgentOperations>[7];
  tasks: Parameters<typeof useInputAgentOperations>[9];
  disposeInput: AppInputParams['disposeInput'];
  readApprovalMode: AppInputParams['readApprovalMode'];
  setApprovalMode: AppInputParams['setApprovalMode'];
  generatePromptContent: AppInputParams['generatePromptContent'];
  readPolicyRules: AppDialogsParams['readPolicyRules'];
  subagentDefinitions: AppDialogsParams['subagentDefinitions'];
  subagentWrites: AppDialogsParams['subagentWrites'];
  profileDefinitions: AppDialogsParams['profileDefinitions'];
  readAgentRecordingPath: () => string | undefined;
  generateSubagentPrompt: (description: string) => Promise<string>;
  settings: LoadedSettings;
  startupWarnings?: string[];
  resumedHistory?: IContent[];
  version: string;
  terminalBackgroundColor?: string;
  runtimeMessageBus?: MessageBus;
  appState: AppState;
  appDispatch: React.Dispatch<AppAction>;
  /** @plan:PLAN-20260211-SESSIONRECORDING.P26 */
  recordingIntegration?: RecordingIntegration;
  recordingOwner?: 'agent' | 'raw';
  /** @plan:PLAN-20260214-SESSIONBROWSER.P23 */
  initialRecordingService?: SessionRecordingService;
  /** @plan:PLAN-20260214-SESSIONBROWSER.P23 */
  initialLockHandle?: LockHandle | null;
  suppressStartupWelcome?: boolean;
  /** P12: optional perf operation lifecycle registry (perf enabled only). */
  operationLifecycle?: OperationLifecycleRegistry;
  /** P12: optional memory telemetry controller (perf+memory enabled only). */
  memoryController?: MemoryTelemetryController;
}

/** Stores retain identity across renders and StrictMode effect replay. */
export function useAppStores(runtime: Pick<SlashCommandRuntime, 'getModel'>): {
  dialogStore: DialogStore;
  terminalStore: TerminalStore;
  turnStore: TurnStore;
  settingsStore: SettingsProfileStore;
  dialogOpeners: DialogOpeners;
} {
  const storesRef = useRef<{
    dialogStore: DialogStore;
    terminalStore: TerminalStore;
    turnStore: TurnStore;
    settingsStore: SettingsProfileStore;
  } | null>(null);
  storesRef.current ??= {
    dialogStore: createDialogStore(),
    terminalStore: createTerminalStore(),
    turnStore: createTurnStore(),
    settingsStore: createSettingsProfileStore({
      currentModel: runtime.getModel(),
    }),
  };
  const stores = storesRef.current;
  const dialogOpeners = useMemo(
    () => createDialogOpeners(stores.dialogStore),
    [stores],
  );
  return { ...stores, dialogOpeners };
}

/** Guidance nudge for sessions without an active provider configured. */
function useUnconfiguredGuidance(
  turnStore: TurnStore,
  dialogStore: DialogStore,
): void {
  const hasActiveProvider = useHasActiveProvider();
  useUnconfiguredProviderGuidance({
    hasActiveProvider: hasActiveProvider(),
    addItem: turnStore.commands.addItem,
    store: dialogStore,
  });
}

/** Dialog-data runtime: wiring only; every param is bootstrap/store-owned. */
function useAppDialogsRuntime(
  props: AppContainerRuntimeProps,
  bootstrap: AppBootstrapResult,
  stores: ReturnType<typeof useAppStores>,
  recordingIntegrationRef: UseRecordingInfrastructureResult['recordingIntegrationRef'],
): AppDialogsResult {
  const {
    dialogStore,
    dialogOpeners,
    terminalStore,
    settingsStore,
    turnStore,
  } = stores;
  useExtensionAutoUpdate({
    settings: props.settings,
    onConsoleMessage: bootstrap.handleNewMessage,
  });
  useUnconfiguredGuidance(turnStore, dialogStore);
  const setProvider = useSetProvider();
  return useAppDialogs({
    config: props.slashCommandRuntime,
    recordRecordingEvent: bootstrap.recordRecordingEvent,
    switchProviderAfterAuth: useCallback(
      (provider: string) =>
        setProvider(provider, undefined, { autoOAuth: false }),
      [setProvider],
    ),
    listTools: props.listCommandTools,
    generatePrompt: props.generateSubagentPrompt,
    readPolicyRules: props.readPolicyRules,
    subagentDefinitions: props.subagentDefinitions,
    subagentWrites: props.subagentWrites,
    profileDefinitions: props.profileDefinitions,
    settings: props.settings,
    store: dialogStore,
    dialogs: dialogOpeners,
    terminalStore,
    settingsStore,
    turnStore,
    appDispatch: props.appDispatch,
    handleNewMessage: bootstrap.handleNewMessage,
    recordingIntegration: props.recordingIntegration,
    recordingOwner: props.recordingOwner,
    recordingIntegrationRef,
    getActiveModelName: useGetActiveModelName(),
    getActiveProfileName: useGetActiveProfileName(),
    getActiveProviderName: useGetActiveProviderName(),
    getLoadBalancerStats: useGetLoadBalancerStats(),
    listAvailableModels: useListAvailableModels(),
    listProviders: useListProviders(),
    listSavedProfiles: useListSavedProfiles(),
    loadProfileByName: useLoadProfileByName(),
    providerStatus: useProviderStatus(),
    saveProfileSnapshot: useSaveProfileSnapshot(),
    setActiveModel: useSetActiveModel(),
    setDefaultProfileName: useSetDefaultProfileName(),
    setProvider,
    updateActiveProviderApiKey: useUpdateActiveProviderApiKey(),
    suppressStartupWelcome: props.suppressStartupWelcome,
    shouldShowIdePrompt: bootstrap.shouldShowIdePrompt,
    currentIDE: bootstrap.currentIDE,
  });
}

/** Input runtime: wiring only; every param is bootstrap/store-owned. */
function useInputBindings(
  commands: SlashCommandProcessorCoreResult,
  setQuittingMessagesRef: React.MutableRefObject<
    ((messages: HistoryItem[]) => void) | null
  >,
  props: AppContainerRuntimeProps,
  inputView: ReturnType<typeof buildInputView>,
  recordingSwapCallbacks: UseRecordingInfrastructureResult['recordingSwapCallbacks'],
): AppInputResult {
  const { dialogStore, turnStore } = inputView;
  const { uiRuntime: runtime, slashCommandRuntime: config } = props;
  const browser = useInputBrowserCommands(
    props.session,
    config,
    props.recordingOwner,
    recordingSwapCallbacks,
    props.mediaStore,
    props.readClientHistory,
    turnStore,
    dialogStore,
    commands.commandContext.ui.clear,
  );
  const stream = useInputAgentOperations(
    props.readHistory,
    props.stream,
    props.appendHistory,
    props.injectSteer,
    props.getProviderContextLimit,
    props.getContentPrefixIdentity,
    props.tools,
    props.mcp,
    props.metrics,
    props.tasks,
    props.session,
    props.recordingOwner,
    props.recordingIntegration,
  );
  const policy = useInputStreamPolicy(
    runtime.session,
    runtime.events,
    runtime.model,
    runtime.ephemeral,
    runtime.shell,
    runtime.checkpoint,
    runtime.files,
    runtime.settings,
    runtime.bucketFailover,
    runtime.sessionLimits,
    runtime.projectTempDir,
    runtime.projectCheckpointsDir,
  );
  return useAppInput({
    ...stream,
    ...policy,
    ...browser,
    commands,
    setQuittingMessagesRef,
    disposeInput: props.disposeInput,
    readApprovalMode: props.readApprovalMode,
    setApprovalMode: props.setApprovalMode,
    generatePromptContent: props.generatePromptContent,
    injectInputSteer: props.injectSteer,
    ...useInputReadOperations(
      runtime.hooks,
      runtime.app,
      runtime.agentClientSource,
      runtime.ide,
      runtime.shell,
      runtime.mcp,
      useBound(config, config.refreshMemory),
      useBound(config, config.getDebugMode),
    ),
    ...inputView,
  });
}

function useAppInputRuntime(
  props: AppContainerRuntimeProps,
  bootstrap: AppBootstrapResult,
  stores: ReturnType<typeof useAppStores>,
  recordingIntegrationRef: UseRecordingInfrastructureResult['recordingIntegrationRef'],
  recordingSwapCallbacks: UseRecordingInfrastructureResult['recordingSwapCallbacks'],
) {
  const view = useInputCommandView(
    useBound(
      props.slashCommandRuntime,
      props.slashCommandRuntime.getExtensions,
    ),
    props.slashCommandRuntime.getWorkingDir(),
    stores,
    props.settings,
    bootstrap.setLlxprtMdFileCount,
  );
  const commands = useSlashCommandProcessorCore({
    registerCredentials: props.registerCredentials,
    readBuiltinCommands: props.readBuiltinCommands,
    loadRegisteredCommands: props.loadRegisteredCommands,
    subscribeCommandChanges: props.subscribeCommandChanges,
    ...props.historyReads,
    config: props.slashCommandRuntime,
    registerWorkspaceCommands: props.registerWorkspaceCommands,
    registerChatCommands: props.registerChatCommands,
    registerSubagentCommand: props.registerSubagentCommand,
    resumeOwnedCommand: props.resumeOwnedCommand,
    replaceCommandHistory: props.replaceCommandHistory,
    readCommandHistoryService: props.readCommandHistoryService,
    recordCommandEvent: props.recordCommandEvent,
    isMcpDiscoveryPending: props.isMcpDiscoveryPending,
    endCommandSession: props.endCommandSession,
    startNewCommandSession: props.startNewCommandSession,
    startCommandSession: props.startCommandSession,
    listCommandTools: props.listCommandTools,
    ...view,
    recordingIntegration: recordingIntegrationRef?.current ?? undefined,
    recordingSwapCallbacks,
    recordingOwner: props.recordingOwner,
  });
  const inputView = buildInputView(
    stores,
    props.settings,
    props.appState,
    props.appDispatch,
    props.operationLifecycle,
    props.uiRuntime.app.getSubagentManager(),
    bootstrap.setIdePromptAnswered,
    bootstrap.setLlxprtMdFileCount,
  );
  return useInputBindings(
    commands,
    view.setQuittingMessagesRef,
    props,
    inputView,
    recordingSwapCallbacks,
  );
}

function useBootstrapMemoryReads(memory: UiRuntime['memory']) {
  return {
    readLlxprtMdFileCount: useBound(memory, memory.getLlxprtMdFileCount),
    readCoreMemoryFileCount: useBound(memory, memory.getCoreMemoryFileCount),
  };
}

export const AppContainerRuntime = (props: AppContainerRuntimeProps) => {
  debug.debug('AppContainer architecture active (v2)');
  const { uiRuntime, slashCommandRuntime: config, settings, metrics } = props;
  const stores = useAppStores(config);
  const { dialogStore, terminalStore, turnStore, settingsStore } = stores;
  const { recordingIntegrationRef, recordingSwapCallbacks } =
    useRecordingInfrastructure(
      props.initialRecordingService,
      props.recordingIntegration,
      props.initialLockHandle,
      props.recordingOwner,
    );
  const bootstrap = useBootstrapRuntime(
    {
      ...useBootstrapMemoryReads(uiRuntime.memory),
      triggerSessionStart: props.triggerSessionStart,
      appendHistory: props.appendHistory,
      recordRecordingEvent: props.recordRecordingEvent,
      setTokenTrackingMetrics: useBound(
        metrics,
        metrics.setTokenTrackingMetrics,
      ),
      readProviderMetrics: props.readProviderMetrics,
      readSessionTokenUsage: props.readSessionTokenUsage,
      resumedHistory: props.resumedHistory,
      version: props.version,
      memoryController: props.memoryController,
    },
    settings.merged,
    stores,
    uiRuntime.ephemeral,
    uiRuntime.shell,
    uiRuntime.ide,
    uiRuntime.app,
    props.readTokenHistory,
    props.recordingOwner,
    recordingIntegrationRef,
  );
  const dialogs = useAppDialogsRuntime(
    props,
    bootstrap,
    stores,
    recordingIntegrationRef,
  );
  const input = useAppInputRuntime(
    props,
    bootstrap,
    stores,
    recordingIntegrationRef,
    recordingSwapCallbacks,
  );
  const layout = useAppLayout({
    uiRuntime,
    settings,
    clearConsoleMessagesState: bootstrap.clearConsoleMessagesState,
    turnStore,
    store: dialogStore,
    terminalStore,
    settingsStore,
  });
  return renderAppRuntimeView(
    props.runtimeMessageBus,
    config,
    props.version,
    uiRuntime.app.getScreenReader(),
    uiRuntime.app.getAccessibility().disableLoadingPhrases === true,
    uiRuntime.app.getDebugMode(),
    bootstrap,
    settings,
    props.startupWarnings,
    layout,
    useAppCommands(dialogs, input, layout, terminalStore),
    stores,
    useTranscriptReader(
      props.recordingOwner,
      recordingSwapCallbacks,
      props.readAgentRecordingPath,
    ),
  );
};

function useTranscriptReader(
  recordingOwner: 'agent' | 'raw' | undefined,
  recordingSwapCallbacks: UseRecordingInfrastructureResult['recordingSwapCallbacks'],
  readAgentRecordingPath: () => string | undefined,
): () => string | undefined {
  return useCallback(
    () =>
      getInteractiveTranscriptPath(
        recordingOwner,
        readAgentRecordingPath,
        () =>
          recordingSwapCallbacks?.getCurrentRecording()?.getFilePath() ??
          undefined,
      ),
    [recordingOwner, recordingSwapCallbacks, readAgentRecordingPath],
  );
}

interface AppRuntimeViewProps extends DefaultAppLayoutProps {
  appCommands: AppCommandBindings;
  dialogStore: DialogStore;
  terminalStore: TerminalStore;
  turnStore: TurnStore;
  settingsStore: SettingsProfileStore;
  getTranscriptFilePath: () => string | undefined;
}

function AppRuntimeView({
  appCommands,
  dialogStore,
  terminalStore,
  turnStore,
  settingsStore,
  getTranscriptFilePath,
  ...layoutProps
}: AppRuntimeViewProps): React.ReactNode {
  return (
    <TerminalProvider store={terminalStore}>
      <TurnProvider store={turnStore}>
        <ToolResultExpansionProvider
          getTranscriptFilePath={getTranscriptFilePath}
        >
          <SettingsProfileProvider store={settingsStore}>
            <DialogProvider store={dialogStore}>
              <AppCommandsProvider value={appCommands}>
                <DefaultAppLayout {...layoutProps} />
              </AppCommandsProvider>
            </DialogProvider>
          </SettingsProfileProvider>
        </ToolResultExpansionProvider>
      </TurnProvider>
    </TerminalProvider>
  );
}

function useInputBrowserCommands(
  session: Parameters<typeof useBrowserCatalogCommands>[0] &
    Pick<Agent['session'], 'resume'>,
  config: Parameters<typeof bindRawBrowserSession>[0] &
    Parameters<typeof useBrowserCatalogCommands>[2] &
    Parameters<typeof resolveEmojiFilterMode>[0],
  recordingOwner: 'agent' | 'raw' | undefined,
  recordingSwapCallbacks: UseRecordingInfrastructureResult['recordingSwapCallbacks'],
  mediaStore: Agent['agentClient']['mediaStore'],
  readRawHistory: () => ReturnType<Agent['agentClient']['getHistoryService']>,
  turnStore: TurnStore,
  dialogStore: DialogStore,
  clear: () => void,
) {
  const { readBrowserCatalog, deleteBrowserTarget } = useBrowserCatalogCommands(
    session,
    recordingOwner,
    config,
    recordingSwapCallbacks,
    mediaStore,
  );
  const resumeBrowserTarget = useMemo(() => {
    const close = () => dialogStore.commands.closeDialog('sessionBrowser');
    if (recordingOwner === 'agent')
      return bindOwnerBrowserResume(
        (target) =>
          resumeOwnerSession(
            session.resume.bind(session),
            target.kind === 'session'
              ? target.session.sessionId
              : target.checkpointId,
            resolveEmojiFilterMode(config),
            session.listBrowserTargetsDetailed.bind(session),
          ),
        turnStore.commands.loadHistory,
        turnStore.commands.addItem,
        close,
      );
    const logger = new DebugLogger('llxprt:ui:dialogmanager');
    return bindRawBrowserResume(
      bindRawBrowserSession(
        config,
        readRawHistory,
        recordingSwapCallbacks,
        logger,
      ),
      () => resolveEmojiFilterMode(config),
      clear,
      turnStore.commands.addItem,
      close,
      logger,
    );
  }, [
    session,
    readRawHistory,
    config,
    turnStore,
    dialogStore,
    recordingOwner,
    recordingSwapCallbacks,
    clear,
  ]);
  return { readBrowserCatalog, deleteBrowserTarget, resumeBrowserTarget };
}

function useInputCommandView(
  readExtensions: () => ReturnType<SlashCommandRuntime['getExtensions']>,
  workingDir: string,
  stores: ReturnType<typeof useAppStores>,
  settings: LoadedSettings,
  setLlxprtMdFileCount: (count: number) => void,
) {
  const {
    settingsStore,
    terminalStore,
    dialogStore,
    dialogOpeners: dialogs,
    turnStore,
  } = stores;
  const { toggleVimEnabled } = useVimMode();
  const setQuittingMessagesRef = useRef<
    ((messages: HistoryItem[]) => void) | null
  >(null);
  const quitHandler = useCallback((messages: HistoryItem[]) => {
    setQuittingMessagesRef.current?.(messages);
  }, []);
  const { addItem, clearItems, loadHistory, refreshStatic, setIsProcessing } =
    turnStore.commands;
  const extensions = useExtensionUpdates(
    readExtensions(),
    addItem,
    workingDir,
    dialogStore,
  );
  const actions = useStoreSelector(
    settingsStore.store,
    (state) => state.dialogActions,
  );
  const commandActions = useSlashCommandActions({
    ...actions,
    dialogs,
    quitHandler,
    setDebugMessage: settingsStore.commands.setDebugMessage,
    toggleCorgiMode: noop,
    toggleDebugProfiler: terminalStore.commands.toggleDebugProfiler,
    dispatchExtensionStateUpdate: extensions.dispatchExtensionStateUpdate,
    addConfirmUpdateExtensionRequest:
      extensions.addConfirmUpdateExtensionRequest,
  });
  const { todos, updateTodos } = useTodoContext();
  const todoContext = useMemo(
    () => ({ todos, updateTodos, refreshTodos: noop }),
    [todos, updateTodos],
  );
  return {
    actions: commandActions,
    todoContext,
    settings,
    addItem,
    clearItems,
    loadHistory,
    refreshStatic,
    setIsProcessing,
    toggleVimEnabled,
    setLlxprtMdFileCount,
    store: dialogStore,
    isConfigInitialized: true,
    setQuittingMessagesRef,
    extensionsUpdateState: extensions.extensionsUpdateState,
  };
}
function noop(): void {}

function useInputReadOperations(
  hooks: UiRuntime['hooks'],
  app: UiRuntime['app'],
  source: UiRuntime['agentClientSource'],
  ide: UiRuntime['ide'],
  shell: UiRuntime['shell'],
  mcp: UiRuntime['mcp'],
  refreshMemory: SlashCommandRuntime['refreshMemory'],
  readDebugMode: () => boolean,
) {
  return {
    refreshMemory,
    readDebugMode,
    endInputHookSession: useBound(hooks, hooks.endHookSession),
    readInitialPrompt: useBound(app, app.getQuestion),
    isAgentClientPresent: useCallback(
      () => Boolean(source.getAgentClient()),
      [source],
    ),
    readIdeMode: useBound(ide, ide.getIdeMode),
    readInteractiveShellEnabled: useBound(
      shell,
      shell.getEnableInteractiveShell,
    ),
    readMcpServers: useBound(mcp, mcp.getMcpServers),
  };
}

function buildInputView(
  stores: ReturnType<typeof useAppStores>,
  settings: LoadedSettings,
  appState: AppState,
  appDispatch: React.Dispatch<AppAction>,
  operationLifecycle: OperationLifecycleRegistry | undefined,
  subagentManager: ReturnType<UiRuntime['app']['getSubagentManager']>,
  setIdePromptAnswered: AppBootstrapResult['setIdePromptAnswered'],
  setLlxprtMdFileCount: (count: number) => void,
) {
  const {
    dialogOpeners,
    dialogStore,
    terminalStore,
    turnStore,
    settingsStore,
  } = stores;
  return {
    settings,
    subagentManager,
    turnStore,
    setIdePromptAnswered,
    setLlxprtMdFileCount,
    dialogs: dialogOpeners,
    store: dialogStore,
    dialogStore,
    terminalStore,
    settingsStore,
    appState,
    appDispatch,
    operationLifecycle,
  };
}

function renderAppRuntimeView(
  runtimeMessageBus: MessageBus | undefined,
  slashCommandRuntime: DefaultAppLayoutProps['slashCommandRuntime'],
  version: string,
  screenReaderEnabled: boolean,
  disableLoadingPhrases: boolean,
  debugMode: boolean,
  bootstrap: AppBootstrapResult,
  settings: LoadedSettings,
  startupWarnings: string[] | undefined,
  layout: ReturnType<typeof useAppLayout>,
  commands: AppCommandBindings,
  stores: ReturnType<typeof useAppStores>,
  readTranscript: () => string | undefined,
): React.ReactNode {
  const { dialogStore, terminalStore, turnStore, settingsStore } = stores;
  return (
    <AppRuntimeView
      runtimeMessageBus={runtimeMessageBus}
      slashCommandRuntime={slashCommandRuntime}
      version={version}
      screenReaderEnabled={screenReaderEnabled}
      disableLoadingPhrases={disableLoadingPhrases}
      debugMode={debugMode}
      settings={settings}
      startupWarnings={startupWarnings ?? []}
      nightly={bootstrap.nightly}
      updateInfo={bootstrap.updateInfo}
      mainControlsRef={layout.mainControlsRef}
      rootUiRef={layout.rootUiRef}
      pendingHistoryItemRef={layout.pendingHistoryItemRef}
      contextFileNames={layout.contextFileNames}
      appCommands={commands}
      dialogStore={dialogStore}
      terminalStore={terminalStore}
      turnStore={turnStore}
      settingsStore={settingsStore}
      getTranscriptFilePath={readTranscript}
    />
  );
}
