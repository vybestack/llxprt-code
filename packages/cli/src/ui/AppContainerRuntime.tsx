/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
import type { HistoryItem } from './types.js';
import type { OperationLifecycleRegistry } from './hooks/agentStream/operationLifecycle.js';
import type { MemoryTelemetryController } from './hooks/memoryTrend/memoryTelemetry.js';
import { UIStateProvider } from './contexts/UIStateContext.js';
import { UIActionsProvider } from './contexts/UIActionsContext.js';
import { DefaultAppLayout } from './layouts/DefaultAppLayout.js';
import { useUIStateBuilder } from './containers/AppContainer/builders/useUIStateBuilder.js';
import { useUIActionsBuilder } from './containers/AppContainer/builders/useUIActionsBuilder.js';
import { useAppBootstrap } from './containers/AppContainer/hooks/useAppBootstrap.js';
import type { AppBootstrapResult } from './containers/AppContainer/hooks/useAppBootstrap.js';
import { useAppDialogs } from './containers/AppContainer/hooks/useAppDialogs.js';
import type { AppDialogsResult } from './containers/AppContainer/hooks/useAppDialogs.js';
import { useAppInput } from './containers/AppContainer/hooks/useAppInput.js';
import type {
  AppInputParams,
  AppInputResult,
} from './containers/AppContainer/hooks/useAppInput.js';
import { useAppLayout } from './containers/AppContainer/hooks/useAppLayout.js';
import type {
  AppLayoutParams,
  AppLayoutResult,
} from './containers/AppContainer/hooks/useAppLayout.js';
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
import { useStoreSelector } from './stores/useStoreSelector.js';
import { useRef, useMemo } from 'react';

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

type HookResults = {
  bootstrap: AppBootstrapResult;
  dialogs: AppDialogsResult;
  input: AppInputResult;
  layout: AppLayoutResult;
};

function buildInputParams(
  bootstrap: AppBootstrapResult,
  dialogs: AppDialogsResult,
  appState: AppState,
  appDispatch: React.Dispatch<AppAction>,
  slashCommandRuntime: SlashCommandRuntime,
  dialogOpeners: DialogOpeners,
  store: DialogStore,
  terminalStore: TerminalStore,
  turnStore: TurnStore,
): AppInputParams {
  return {
    streamRuntime: bootstrap.streamRuntime,
    slashCommandRuntime,
    agent: bootstrap.agent,
    settings: bootstrap.settings,
    runtime: bootstrap.runtime,
    subagentManager: bootstrap.uiRuntime.app.getSubagentManager(),
    turnStore,
    todos: bootstrap.todos,
    updateTodos: bootstrap.updateTodos,
    recordingIntegrationRef: bootstrap.recordingIntegrationRef,
    recordingSwapCallbacks: bootstrap.recordingSwapCallbacks,
    recordingIntegration: bootstrap.recordingIntegration,
    runtimeMessageBus: bootstrap.runtimeMessageBus,
    stdin: bootstrap.stdin,
    setRawMode: bootstrap.setRawMode,
    stdout: bootstrap.stdout,
    setIdePromptAnswered: bootstrap.setIdePromptAnswered,
    setLlxprtMdFileCount: bootstrap.setLlxprtMdFileCount,
    dialogs: dialogOpeners,
    store,
    terminalStore,
    openProviderDialog: dialogs.openProviderDialog,
    openLoadProfileDialog: dialogs.openLoadProfileDialog,
    openCreateProfileDialog: dialogs.openCreateProfileDialog,
    openProfileListDialog: dialogs.openProfileListDialog,
    viewProfileDetail: dialogs.viewProfileDetail,
    openProfileEditor: dialogs.openProfileEditor,
    setDebugMessage: dialogs.setDebugMessage,
    toggleCorgiMode: dialogs.toggleCorgiMode,
    toggleDebugProfiler: dialogs.toggleDebugProfiler,
    dispatchExtensionStateUpdate: dialogs.dispatchExtensionStateUpdate,
    addConfirmUpdateExtensionRequest: dialogs.addConfirmUpdateExtensionRequest,
    welcomeActions: dialogs.welcomeActions,
    extensionsUpdateState: dialogs.extensionsUpdateState,
    setIsProcessing: dialogs.setIsProcessing,
    setEmbeddedShellFocused: dialogs.setEmbeddedShellFocused,
    embeddedShellFocused: dialogs.embeddedShellFocused,
    setAuthError: dialogs.setAuthError,
    shellModeActive: dialogs.shellModeActive,
    performMemoryRefresh: dialogs.performMemoryRefresh,
    handleExternalEditorOpen: dialogs.handleExternalEditorOpen,
    refreshStatic: dialogs.refreshStatic,
    // appReducer-held auth state (needsRelogin); dialogs moved to DialogStore.
    appState,
    appDispatch,
  };
}

function buildLayoutParams(
  bootstrap: AppBootstrapResult,
  dialogs: AppDialogsResult,
  input: AppInputResult,
  store: DialogStore,
  terminalStore: TerminalStore,
  turnStore: TurnStore,
): AppLayoutParams {
  return {
    uiRuntime: bootstrap.uiRuntime,
    settings: bootstrap.settings,
    runtimeMessageBus: bootstrap.runtimeMessageBus,
    consoleMessages: bootstrap.consoleMessages,
    clearConsoleMessagesState: bootstrap.clearConsoleMessagesState,
    turnStore,
    refreshStatic: dialogs.refreshStatic,
    renderMarkdown: dialogs.renderMarkdown,
    setRenderMarkdown: dialogs.setRenderMarkdown,
    isTodoPanelCollapsed: dialogs.isTodoPanelCollapsed,
    setIsTodoPanelCollapsed: dialogs.setIsTodoPanelCollapsed,
    isQueuedMessagesPanelCollapsed: dialogs.isQueuedMessagesPanelCollapsed,
    setIsQueuedMessagesPanelCollapsed:
      dialogs.setIsQueuedMessagesPanelCollapsed,
    ideContextState: dialogs.ideContextState,
    setDebugMessage: dialogs.setDebugMessage,
    store,
    terminalStore,
    embeddedShellFocused: dialogs.embeddedShellFocused,
    setEmbeddedShellFocused: dialogs.setEmbeddedShellFocused,
    startupGuardsInitialized: dialogs.startupGuardsInitialized,
    streamingState: input.streamingState,
    pendingHistoryItems: input.pendingHistoryItems,
    cancelOngoingRequest: input.cancelOngoingRequest,
    activeShellPtyId: input.activeShellPtyId,
    ctrlCPressedOnce: input.ctrlCPressedOnce,
    requestCtrlCExit: input.requestCtrlCExit,
    requestCtrlDExit: input.requestCtrlDExit,
    handleSlashCommand: input.handleSlashCommand,
    inputHistoryStore: input.inputHistoryStore,
    handleUserInputSubmit: input.handleUserInputSubmit,
    handleSteer: input.handleSteer,
    interactiveRuntimeReady: input.interactiveRuntimeReady,
    vimModeEnabled: input.vimModeEnabled,
    buffer: input.buffer,
  };
}

function buildUIStateParamsCore(
  r: HookResults,
  slashCommandRuntime: SlashCommandRuntime,
  history: HistoryItem[],
) {
  const { bootstrap: b, dialogs: d, input: i } = r;
  return {
    slashCommandRuntime,
    settings: b.settings,
    settingsNonce: d.settingsNonce,
    terminalBackgroundColor: b.uiRuntime.shell.getTerminalBackground(),
    history,
    pendingHistoryItems: i.pendingHistoryItems,
    streamingState: i.streamingState,
    thought: i.thought,
    buffer: i.buffer,
    shellModeActive: d.shellModeActive,
    providerOptions: d.providerOptions,
    createProfileProviders: d.createProfileProviders,
    selectedProvider: d.selectedProvider,
    currentModel: d.currentModel,
    currentModelLabel: d.currentModelLabel,
    contextLimit: d.contextLimit,
    profiles: d.profiles,
    toolsDialogAction: d.toolsDialogAction,
    toolsDialogTools: d.toolsDialogTools,
    toolsDialogDisabledTools: d.toolsDialogDisabledTools,
  };
}

function buildUIStateParamsExtra(
  r: HookResults,
  isProcessing: boolean,
  staticKey: number,
) {
  const { bootstrap: b, dialogs: d, input: i, layout: l } = r;
  return {
    profileListItems: d.profileListItems,
    selectedProfileName: d.selectedProfileName,
    selectedProfileData: d.selectedProfileData,
    defaultProfileName: d.defaultProfileName,
    activeProfileName: d.activeProfileName,
    profileDialogError: d.profileDialogError,
    profileDialogLoading: d.profileDialogLoading,
    ctrlCPressedOnce: i.ctrlCPressedOnce,
    ctrlDPressedOnce: i.ctrlDPressedOnce,
    showEscapePrompt: d.showEscapePrompt,
    quittingMessages: i.quittingMessages,
    isTodoPanelCollapsed: d.isTodoPanelCollapsed,
    isQueuedMessagesPanelCollapsed: d.isQueuedMessagesPanelCollapsed,
    queuedSubmissions: i.queuedSubmissions,
    vimModeEnabled: i.vimModeEnabled,
    vimMode: i.vimMode,
    ideContextState: d.ideContextState,
    llxprtMdFileCount: b.llxprtMdFileCount,
    coreMemoryFileCount: b.coreMemoryFileCount,
    branchName: l.branchName,
    branchIsDirty: l.branchIsDirty,
    errorCount: d.errorCount,
    activeHooks: l.activeHooks,
    consoleMessages: l.filteredConsoleMessages,
    elapsedTime: i.elapsedTime,
    currentLoadingPhrase: i.currentLoadingPhrase,
    showAutoAcceptIndicator: i.showAutoAcceptIndicator,
    tokenMetrics: b.tokenMetrics,
    historyTokenCount: b.sessionStats.historyTokenCount,
    initError: i.initError,
    authError: d.authError,
    themeError: d.themeError,
    editorError: d.editorError,
    isProcessing,
    rootUiRef: l.rootUiRef,
    pendingHistoryItemRef: l.pendingHistoryItemRef,
    slashCommands: i.slashCommands,
    commandContext: i.commandContext,
    currentIDE: b.currentIDE,
    isTrustedFolder: b.uiRuntime.app.isTrustedFolder(),
    welcomeState: d.welcomeState,
    welcomeAvailableProviders: d.welcomeAvailableProviders,
    welcomeAvailableModels: d.welcomeAvailableModels,
    inputHistory: i.inputHistoryStore.inputHistory,
    staticKey,
    debugMessage: d.debugMessage,
    showDebugProfiler: d.showDebugProfiler,
    placeholder: l.placeholder,
    queueErrorMessage: d.queueErrorMessage,
    renderMarkdown: d.renderMarkdown,
    activeShellPtyId: i.activeShellPtyId,
    embeddedShellFocused: d.embeddedShellFocused,
  };
}

function dialogActionsParams(d: HookResults['dialogs']) {
  return {
    refreshStatic: d.refreshStatic,
    handleThemeSelect: d.handleThemeSelect,
    handleThemeHighlight: d.handleThemeHighlight,
    handleAuthSelect: d.handleAuthSelect,
    handleEditorSelect: d.handleEditorSelect,
    handleProviderSelect: d.handleProviderSelect,
    handleProfileSelect: d.handleProfileSelect,
    viewProfileDetail: d.viewProfileDetail,
    closeProfileDetailDialog: d.closeProfileDetailDialog,
    loadProfileFromDetail: d.loadProfileFromDetail,
    deleteProfileFromDetail: d.deleteProfileFromDetail,
    deleteProfileFromList: d.deleteProfileFromList,
    setProfileAsDefault: d.setProfileAsDefault,
    openProfileEditor: d.openProfileEditor,
    closeProfileEditor: d.closeProfileEditor,
    saveProfileFromEditor: d.saveProfileFromEditor,
    handleToolsSelect: d.handleToolsSelect,
    handleFolderTrustSelect: d.handleFolderTrustSelect,
    welcomeActions: d.welcomeActions,
    triggerWelcomeAuth: d.triggerWelcomeAuth,
    // Open/close state for the remaining dialog families lives in the
    // DialogStore; this is the domain side effect of the migration nudge.
    onWorkspaceMigrationDialogOpen: d.onWorkspaceMigrationDialogOpen,
    performMemoryRefresh: d.performMemoryRefresh,
    setShellModeActive: d.setShellModeActive,
    handleEscapePromptChange: d.handleEscapePromptChange,
    setQueueErrorMessage: d.setQueueErrorMessage,
  };
}

function buildUIActionsParams(r: HookResults, turnStore: TurnStore) {
  const { input: i, layout: l } = r;
  const { addItem, clearItems, loadHistory } = turnStore.commands;
  return {
    addItem,
    clearItems,
    loadHistory,
    handleUserInputSubmit: i.handleUserInputSubmit,
    handleSteer: i.handleSteer,
    handleClearScreen: l.handleClearScreen,
    handleSettingsRestart: i.handleSettingsRestart,
    handleAuthTimeout: i.handleAuthTimeout,
    handleIdePromptComplete: i.handleIdePromptComplete,
    vimHandleInput: i.vimHandleInput,
    toggleVimEnabled: i.toggleVimEnabled,
    handleSlashCommand: i.handleSlashCommand,
    handleOAuthCodeDialogClose: i.handleOAuthCodeDialogClose,
    handleOAuthCodeSubmit: i.handleOAuthCodeSubmit,
    cancelOngoingRequest: i.cancelOngoingRequest,
    sendAllQueuedSubmissions: i.sendAllQueuedSubmissions,
    steerAllQueuedSubmissions: i.steerAllQueuedSubmissions,
    clearQueuedSubmissions: i.clearQueuedSubmissions,
    ...dialogActionsParams(r.dialogs),
  };
}

/**
 * Store instances live for the lifetime of the mounted app; the ref keeps
 * StrictMode double-mounts from creating a second instance.
 */
function useTerminalStoreInstance(): TerminalStore {
  const terminalStoreRef = useRef<TerminalStore | null>(null);
  terminalStoreRef.current ??= createTerminalStore();
  return terminalStoreRef.current;
}

/** Same lifetime/StrictMode rules as the terminal store instance. */
function useTurnStoreInstance(): TurnStore {
  const turnStoreRef = useRef<TurnStore | null>(null);
  turnStoreRef.current ??= createTurnStore();
  return turnStoreRef.current;
}

/** Guidance nudge for sessions without an active provider configured. */
function useUnconfiguredGuidance(
  props: AppContainerRuntimeProps,
  turnStore: TurnStore,
  dialogStore: DialogStore,
): void {
  useUnconfiguredProviderGuidance({
    hasActiveProvider:
      props.uiRuntime.model.getProviderManager()?.hasActiveProvider() ?? false,
    addItem: turnStore.commands.addItem,
    store: dialogStore,
  });
}

/** Dialog-data runtime: wiring only; every param is bootstrap/store-owned. */
function useAppDialogsRuntime(
  props: AppContainerRuntimeProps,
  bootstrap: AppBootstrapResult,
  dialogStore: DialogStore,
  dialogOpeners: DialogOpeners,
  terminalStore: TerminalStore,
  turnStore: TurnStore,
): AppDialogsResult {
  return useAppDialogs({
    config: props.slashCommandRuntime,
    agent: props.agent,
    settings: bootstrap.settings,
    store: dialogStore,
    dialogs: dialogOpeners,
    terminalStore,
    turnStore,
    appDispatch: props.appDispatch,
    handleNewMessage: bootstrap.handleNewMessage,
    recordingIntegration: bootstrap.recordingIntegration,
    recordingIntegrationRef: bootstrap.recordingIntegrationRef,
    runtime: bootstrap.runtime,
    consoleMessages: bootstrap.consoleMessages,
    setLlxprtMdFileCount: bootstrap.setLlxprtMdFileCount,
    suppressStartupWelcome: props.suppressStartupWelcome,
    shouldShowIdePrompt: bootstrap.shouldShowIdePrompt,
    currentIDE: bootstrap.currentIDE,
  });
}

/**
 * Narrow turn-store reads the UIState/UIActions bags still project; the
 * DefaultAppLayout subtree consumes them through the legacy contexts until
 * slice D replaces those providers.
 */
function useTurnStoreProjection(turnStore: TurnStore) {
  const history = useStoreSelector(turnStore.store, (s) => s.history);
  const isProcessing = useStoreSelector(turnStore.store, (s) => s.isProcessing);
  const staticKey = useStoreSelector(turnStore.store, (s) => s.staticKey);
  return { history, isProcessing, staticKey };
}

export const AppContainerRuntime = (props: AppContainerRuntimeProps) => {
  debug.debug('AppContainer architecture active (v2)');
  const dialogStoreRef = useRef<DialogStore | null>(null);
  dialogStoreRef.current ??= createDialogStore();
  const dialogStore = dialogStoreRef.current;
  /** Stable openers object derived once from the store commands. */
  const dialogOpeners = useMemo(
    () => createDialogOpeners(dialogStore),
    [dialogStore],
  );
  const terminalStore = useTerminalStoreInstance();
  const turnStore = useTurnStoreInstance();
  const {
    history: turnHistory,
    isProcessing,
    staticKey,
  } = useTurnStoreProjection(turnStore);
  const bootstrap = useAppBootstrap({ ...props, terminalStore, turnStore });
  const dialogs = useAppDialogsRuntime(
    props,
    bootstrap,
    dialogStore,
    dialogOpeners,
    terminalStore,
    turnStore,
  );
  const input = useAppInput({
    ...buildInputParams(
      bootstrap,
      dialogs,
      props.appState,
      props.appDispatch,
      props.slashCommandRuntime,
      dialogOpeners,
      dialogStore,
      terminalStore,
      turnStore,
    ),
    operationLifecycle: props.operationLifecycle,
  });
  const layout = useAppLayout(
    buildLayoutParams(
      bootstrap,
      dialogs,
      input,
      dialogStore,
      terminalStore,
      turnStore,
    ),
  );
  useUnconfiguredGuidance(props, turnStore, dialogStore);
  const r: HookResults = { bootstrap, dialogs, input, layout };
  const uiState = useUIStateBuilder({
    ...buildUIStateParamsCore(r, props.slashCommandRuntime, turnHistory),
    ...buildUIStateParamsExtra(r, isProcessing, staticKey),
  });
  const uiActions = useUIActionsBuilder(buildUIActionsParams(r, turnStore));
  return (
    <TerminalProvider store={terminalStore}>
      <TurnProvider store={turnStore}>
        <DialogProvider store={dialogStore}>
          <UIStateProvider value={uiState}>
            <UIActionsProvider value={uiActions}>
              <DefaultAppLayout
                uiRuntime={bootstrap.uiRuntime}
                slashCommandRuntime={props.slashCommandRuntime}
                settings={bootstrap.settings}
                startupWarnings={bootstrap.startupWarnings}
                version={props.version}
                nightly={bootstrap.nightly}
                mainControlsRef={layout.mainControlsRef}
                contextFileNames={layout.contextFileNames}
                updateInfo={bootstrap.updateInfo}
              />
            </UIActionsProvider>
          </UIStateProvider>
        </DialogProvider>
      </TurnProvider>
    </TerminalProvider>
  );
};
