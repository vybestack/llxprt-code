/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useRuntimeApi } from './contexts/RuntimeContext.js';
import { resolveEmojiFilterMode } from './utils/iContentToHistoryItems.js';
import { registerCleanup } from '../utils/cleanup.js';
import {
  bindHistoryTokenSubscription,
  bindRecordingHistorySubscription,
} from './containers/AppContainer/hooks/historyTokenSubscriptions.js';

import type React from 'react';
import type {
  MessageBus,
  RecordingIntegration,
  SessionRecordingService,
  LockHandle,
  IContent,
} from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
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
import { useAppBootstrap } from './containers/AppContainer/hooks/useAppBootstrap.js';
import type { AppBootstrapResult } from './containers/AppContainer/hooks/useAppBootstrap.js';
import { useAppDialogs } from './containers/AppContainer/hooks/useAppDialogs.js';
import type { AppDialogsResult } from './containers/AppContainer/hooks/useAppDialogs.js';
import { useAppInput } from './containers/AppContainer/hooks/useAppInput.js';
import type { AppInputResult } from './containers/AppContainer/hooks/useAppInput.js';
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
import {
  useBound,
  useContentIdentityReader,
} from './hooks/agentStream/useStreamOwnerCallbacks.js';
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
import type { SlashCommandProcessorCoreResult } from './hooks/useSlashCommandProcessorCore.js';
import { useSlashCommandProcessorCore } from './hooks/useSlashCommandProcessorCore.js';
import type { HistoryItem } from './types.js';
import type { PromptContentGenerator } from './hooks/usePromptCompletion.js';
import {
  useInputAgentOperations,
  useInputStreamPolicy,
} from './inputOwnerBindings.js';
import { useAutoPromptOperation } from './hooks/useAutoPromptOperation.js';
import { bindPolicyRulesReader } from './hooks/policyRulesReaderHost.js';

const debug = new DebugLogger('llxprt:ui:appcontainer');

export interface AppContainerRuntimeProps {
  uiRuntime: UiRuntime;
  slashCommandRuntime: SlashCommandRuntime;
  /**
   * The single interactive Agent threaded from the composition root.
   */
  agent: Agent;
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
  props: AppContainerRuntimeProps,
  turnStore: TurnStore,
  dialogStore: DialogStore,
): void {
  useUnconfiguredProviderGuidance({
    hasActiveProvider: props.agent.hasActiveProvider(),
    addItem: turnStore.commands.addItem,
    store: dialogStore,
  });
}

/** Dialog-data runtime: wiring only; every param is bootstrap/store-owned. */
function useAppDialogsRuntime(
  props: AppContainerRuntimeProps,
  bootstrap: AppBootstrapResult,
  stores: ReturnType<typeof useAppStores>,
): AppDialogsResult {
  const {
    dialogStore,
    dialogOpeners,
    terminalStore,
    settingsStore,
    turnStore,
  } = stores;
  return useAppDialogs({
    config: props.slashCommandRuntime,
    recordRecordingEvent: useBound(
      props.agent.session,
      props.agent.session.recordRecordingEvent,
    ),
    switchProviderAfterAuth: useCallback(
      (provider: string) =>
        props.agent.setProvider(provider, undefined, { autoOAuth: false }),
      [props.agent],
    ),
    listTools: useBound(props.agent.tools, props.agent.tools.list),
    generatePrompt: useAutoPromptOperation(
      useBound(props.agent, props.agent.getProvider),
      useCallback(() => props.agent.agentClient, [props.agent]),
      useBound(
        props.agent.sessionClient,
        props.agent.sessionClient.createDetachedAgentClient,
      ),
      useBound(
        props.slashCommandRuntime,
        props.slashCommandRuntime.getContentGeneratorConfig,
      ),
    ),
    readPolicyRules: useMemo(
      () =>
        bindPolicyRulesReader(props.agent.policy, () =>
          props.slashCommandRuntime.getApprovalMode(),
        ),
      [props.agent.policy, props.slashCommandRuntime],
    ),
    subagentDefinitions: props.agent.workspace.subagentDefinitions,
    subagentWrites: props.agent.workspace.subagentWrites,
    profileDefinitions: props.agent.workspace.profileDefinitions,
    settings: bootstrap.settings,
    store: dialogStore,
    dialogs: dialogOpeners,
    terminalStore,
    settingsStore,
    turnStore,
    appDispatch: props.appDispatch,
    handleNewMessage: bootstrap.handleNewMessage,
    recordingIntegration: bootstrap.recordingIntegration,
    recordingOwner: bootstrap.recordingOwner,
    recordingIntegrationRef: bootstrap.recordingIntegrationRef,
    runtime: useRuntimeApi(),
    suppressStartupWelcome: props.suppressStartupWelcome,
    shouldShowIdePrompt: bootstrap.shouldShowIdePrompt,
    currentIDE: bootstrap.currentIDE,
  });
}

/** Input runtime: wiring only; every param is bootstrap/store-owned. */
function useAppInputRuntime(
  commands: SlashCommandProcessorCoreResult,
  setQuittingMessagesRef: React.MutableRefObject<
    ((messages: HistoryItem[]) => void) | null
  >,
  props: AppContainerRuntimeProps,
  bootstrap: AppBootstrapResult,
  inputView: ReturnType<typeof buildInputView>,
): AppInputResult {
  const { dialogStore, turnStore } = inputView;
  const { agent, uiRuntime: runtime, slashCommandRuntime: config } = props;
  const browser = useInputBrowserCommands(
    agent.session,
    config,
    bootstrap.recordingOwner,
    bootstrap.recordingSwapCallbacks,
    agent.agentClient.mediaStore,
    useCallback(() => agent.agentClient.getHistoryService(), [agent]),
    turnStore,
    dialogStore,
    commands.commandContext.ui.clear,
  );
  const stream = useInputAgentOperations(
    useBound(agent, agent.getHistory),
    useBound(agent, agent.stream),
    useBound(agent, agent.addHistory),
    useBound(agent, agent.injectSteer),
    useBound(agent, agent.getProviderContextLimit),
    useContentIdentityReader(agent),
    agent.tools,
    agent.mcp,
    agent.metrics,
    agent.tasks,
    agent.session,
    bootstrap.recordingOwner,
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
    disposeInput: useBound(agent, agent.dispose),
    readApprovalMode: useBound(agent, agent.getApprovalMode),
    setApprovalMode: useBound(agent, agent.setApprovalMode),
    generatePromptContent: useCallback(
      (...args: Parameters<PromptContentGenerator>) =>
        agent.agentClient.generateContent(...args),
      [agent],
    ),
    injectInputSteer: useBound(agent, agent.injectSteer),
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

function useBootstrapRuntime(
  props: AppContainerRuntimeProps,
  stores: ReturnType<typeof useAppStores>,
): AppBootstrapResult {
  const { terminalStore, turnStore, settingsStore } = stores;
  const { agent, uiRuntime, ...bootstrapProps } = props;
  const tokenLogger = useMemo(
    () => new DebugLogger('llxprt:ui:tokentracking'),
    [],
  );
  const readTokenHistory = useCallback(() => {
    const client = agent.agentClient;
    return client.hasChatInitialized() === true
      ? (client.getHistoryService() ?? null)
      : null;
  }, [agent]);
  return useAppBootstrap({
    ...bootstrapProps,
    readEmojiFilterMode: useCallback(
      () => resolveEmojiFilterMode(uiRuntime.ephemeral),
      [uiRuntime],
    ),
    readLlxprtMdFileCount: useBound(
      uiRuntime.memory,
      uiRuntime.memory.getLlxprtMdFileCount,
    ),
    readCoreMemoryFileCount: useBound(
      uiRuntime.memory,
      uiRuntime.memory.getCoreMemoryFileCount,
    ),
    readTerminalBackground: useBound(
      uiRuntime.shell,
      uiRuntime.shell.getTerminalBackground,
    ),
    readCurrentIde: useCallback(
      () => uiRuntime.ide.getIdeClient()?.getCurrentIde(),
      [uiRuntime],
    ),
    readIdeMode: useBound(uiRuntime.ide, uiRuntime.ide.getIdeMode),
    registerIdeCleanup: useCallback(() => {
      const ideClient = uiRuntime.ide.getIdeClient();
      if (ideClient !== undefined)
        registerCleanup(() => {
          void ideClient.disconnect();
        });
    }, [uiRuntime]),
    readDebugMode: useBound(uiRuntime.app, uiRuntime.app.getDebugMode),
    triggerSessionStart: useBound(agent.hooks, agent.hooks.triggerSessionStart),
    appendHistory: useBound(agent, agent.addHistory),
    recordRecordingEvent: useBound(
      agent.session,
      agent.session.recordRecordingEvent,
    ),
    metrics: agent.metrics,
    subscribeHistoryTokens: useMemo(
      () => bindHistoryTokenSubscription(readTokenHistory, tokenLogger),
      [readTokenHistory, tokenLogger],
    ),
    subscribeRecordingHistory: useMemo(
      () => bindRecordingHistorySubscription(readTokenHistory, tokenLogger),
      [readTokenHistory, tokenLogger],
    ),
    readProviderMetrics: useBound(
      agent.providerReads,
      agent.providerReads.getActiveProviderMetrics,
    ),
    readSessionTokenUsage: useBound(
      agent.providerReads,
      agent.providerReads.getSessionTokenUsage,
    ),
    terminalStore,
    turnStore,
    settingsStore,
  });
}

export const AppContainerRuntime = (props: AppContainerRuntimeProps) => {
  debug.debug('AppContainer architecture active (v2)');
  const stores = useAppStores(props.slashCommandRuntime);
  const { dialogStore, terminalStore, turnStore, settingsStore } = stores;
  const bootstrap = useBootstrapRuntime(props, stores);
  const dialogs = useAppDialogsRuntime(props, bootstrap, stores);
  const { setQuittingMessagesRef, ...view } = useInputCommandView(
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
    config: props.slashCommandRuntime,
    agent: props.agent,
    ...view,
    recordingIntegration:
      bootstrap.recordingIntegrationRef?.current ?? undefined,
    recordingSwapCallbacks: bootstrap.recordingSwapCallbacks,
    recordingOwner: bootstrap.recordingOwner,
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
  const input = useAppInputRuntime(
    commands,
    setQuittingMessagesRef,
    props,
    bootstrap,
    inputView,
  );
  const layout = useAppLayout({
    uiRuntime: props.uiRuntime,
    settings: props.settings,
    clearConsoleMessagesState: bootstrap.clearConsoleMessagesState,
    turnStore,
    store: dialogStore,
    terminalStore,
    settingsStore,
  });
  useUnconfiguredGuidance(props, turnStore, dialogStore);
  const readTranscript = useCallback(
    () =>
      getInteractiveTranscriptPath(
        bootstrap.recordingOwner,
        () => props.agent.session.getRecording().path,
        () =>
          bootstrap.recordingSwapCallbacks
            ?.getCurrentRecording()
            ?.getFilePath() ?? undefined,
      ),
    [bootstrap.recordingOwner, bootstrap.recordingSwapCallbacks, props.agent],
  );
  return renderAppRuntimeView(
    props.runtimeMessageBus,
    props.slashCommandRuntime,
    props.version,
    props.uiRuntime.app.getScreenReader(),
    props.uiRuntime.app.getAccessibility().disableLoadingPhrases === true,
    props.uiRuntime.app.getDebugMode(),
    bootstrap,
    layout,
    useAppCommands(dialogs, input, layout, terminalStore),
    stores,
    readTranscript,
  );
};

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

export function getInteractiveTranscriptPath(
  recordingOwner: 'agent' | 'raw' | undefined,
  readOwnedPath: () => string | undefined,
  readRawPath: () => string | undefined,
): string | undefined {
  return recordingOwner === 'agent' ? readOwnedPath() : readRawPath();
}

function useInputBrowserCommands(
  session: Parameters<typeof useBrowserCatalogCommands>[0] &
    Pick<Agent['session'], 'resume'>,
  config: Parameters<typeof bindRawBrowserSession>[0] &
    Parameters<typeof useBrowserCatalogCommands>[2] &
    Parameters<typeof resolveEmojiFilterMode>[0],
  recordingOwner: 'agent' | 'raw' | undefined,
  recordingSwapCallbacks: AppBootstrapResult['recordingSwapCallbacks'],
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
      settings={bootstrap.settings}
      startupWarnings={bootstrap.startupWarnings}
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
