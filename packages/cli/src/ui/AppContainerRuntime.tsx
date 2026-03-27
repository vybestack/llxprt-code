/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type {
  Config,
  MessageBus,
  RecordingIntegration,
  SessionRecordingService,
  LockHandle,
  IContent,
} from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../config/settings.js';
import type { AppState, AppAction } from './reducers/appReducer.js';
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

const debug = new DebugLogger('llxprt:ui:appcontainer');

export interface AppContainerRuntimeProps {
  config: Config;
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
): AppInputParams {
  return {
    config: bootstrap.config,
    settings: bootstrap.settings,
    runtime: bootstrap.runtime,
    history: bootstrap.history,
    addItem: bootstrap.addItem,
    clearItems: bootstrap.clearItems,
    loadHistory: bootstrap.loadHistory,
    todos: bootstrap.todos,
    updateTodos: bootstrap.updateTodos,
    todoPauseController: bootstrap.todoPauseController,
    todoContinuationRef: bootstrap.todoContinuationRef,
    hadToolCallsRef: bootstrap.hadToolCallsRef,
    registerTodoPause: bootstrap.registerTodoPause,
    recordingIntegrationRef: bootstrap.recordingIntegrationRef,
    recordingSwapCallbacks: bootstrap.recordingSwapCallbacks,
    recordingIntegration: bootstrap.recordingIntegration,
    runtimeMessageBus: bootstrap.runtimeMessageBus,
    stdin: bootstrap.stdin,
    setRawMode: bootstrap.setRawMode,
    stdout: bootstrap.stdout,
    setIdePromptAnswered: bootstrap.setIdePromptAnswered,
    setLlxprtMdFileCount: bootstrap.setLlxprtMdFileCount,
    openAuthDialog: dialogs.openAuthDialog,
    openThemeDialog: dialogs.openThemeDialog,
    openEditorDialog: dialogs.openEditorDialog,
    openPrivacyNotice: dialogs.openPrivacyNotice,
    openSettingsDialog: dialogs.openSettingsDialog,
    openLoggingDialog: dialogs.openLoggingDialog,
    openSubagentDialog: dialogs.openSubagentDialog,
    openModelsDialog: dialogs.openModelsDialog,
    openPermissionsDialog: dialogs.openPermissionsDialog,
    openProviderDialog: dialogs.openProviderDialog,
    openLoadProfileDialog: dialogs.openLoadProfileDialog,
    openCreateProfileDialog: dialogs.openCreateProfileDialog,
    openProfileListDialog: dialogs.openProfileListDialog,
    viewProfileDetail: dialogs.viewProfileDetail,
    openProfileEditor: dialogs.openProfileEditor,
    openSessionBrowserDialog: dialogs.openSessionBrowserDialog,
    setDebugMessage: dialogs.setDebugMessage,
    toggleCorgiMode: dialogs.toggleCorgiMode,
    toggleDebugProfiler: dialogs.toggleDebugProfiler,
    dispatchExtensionStateUpdate: dialogs.dispatchExtensionStateUpdate,
    addConfirmUpdateExtensionRequest: dialogs.addConfirmUpdateExtensionRequest,
    welcomeActions: dialogs.welcomeActions,
    extensionsUpdateState: dialogs.extensionsUpdateState,
    setIsProcessing: dialogs.setIsProcessing,
    isProcessing: dialogs.isProcessing,
    setEmbeddedShellFocused: dialogs.setEmbeddedShellFocused,
    embeddedShellFocused: dialogs.embeddedShellFocused,
    setAuthError: dialogs.setAuthError,
    shellModeActive: dialogs.shellModeActive,
    performMemoryRefresh: dialogs.performMemoryRefresh,
    handleExternalEditorOpen: dialogs.handleExternalEditorOpen,
    refreshStatic: dialogs.refreshStatic,
    appState,
    appDispatch,
  };
}

function buildLayoutParams(
  bootstrap: AppBootstrapResult,
  dialogs: AppDialogsResult,
  input: AppInputResult,
): AppLayoutParams {
  return {
    config: bootstrap.config,
    settings: bootstrap.settings,
    todoContinuationRef: bootstrap.todoContinuationRef,
    hadToolCallsRef: bootstrap.hadToolCallsRef,
    runtimeMessageBus: bootstrap.runtimeMessageBus,
    consoleMessages: bootstrap.consoleMessages,
    clearConsoleMessagesState: bootstrap.clearConsoleMessagesState,
    addItem: bootstrap.addItem,
    clearItems: bootstrap.clearItems,
    history: bootstrap.history,
    constrainHeight: dialogs.constrainHeight,
    setConstrainHeight: dialogs.setConstrainHeight,
    refreshStatic: dialogs.refreshStatic,
    showErrorDetails: dialogs.showErrorDetails,
    setShowErrorDetails: dialogs.setShowErrorDetails,
    showToolDescriptions: dialogs.showToolDescriptions,
    setShowToolDescriptions: dialogs.setShowToolDescriptions,
    renderMarkdown: dialogs.renderMarkdown,
    setRenderMarkdown: dialogs.setRenderMarkdown,
    isTodoPanelCollapsed: dialogs.isTodoPanelCollapsed,
    setIsTodoPanelCollapsed: dialogs.setIsTodoPanelCollapsed,
    setFooterHeight: dialogs.setFooterHeight,
    footerHeight: dialogs.footerHeight,
    copyModeEnabled: dialogs.copyModeEnabled,
    setCopyModeEnabled: dialogs.setCopyModeEnabled,
    useAlternateBuffer: dialogs.useAlternateBuffer,
    ideContextState: dialogs.ideContextState,
    setDebugMessage: dialogs.setDebugMessage,
    isAuthDialogOpen: dialogs.isAuthDialogOpen,
    isThemeDialogOpen: dialogs.isThemeDialogOpen,
    isEditorDialogOpen: dialogs.isEditorDialogOpen,
    isProviderDialogOpen: dialogs.isProviderDialogOpen,
    isToolsDialogOpen: dialogs.isToolsDialogOpen,
    isCreateProfileDialogOpen: dialogs.isCreateProfileDialogOpen,
    showPrivacyNotice: dialogs.showPrivacyNotice,
    isWelcomeDialogOpen: dialogs.isWelcomeDialogOpen,
    embeddedShellFocused: dialogs.embeddedShellFocused,
    setEmbeddedShellFocused: dialogs.setEmbeddedShellFocused,
    streamingState: input.streamingState,
    pendingHistoryItems: input.pendingHistoryItems,
    confirmationRequest: input.confirmationRequest,
    cancelOngoingRequest: input.cancelOngoingRequest,
    activeShellPtyId: input.activeShellPtyId,
    ctrlCPressedOnce: input.ctrlCPressedOnce,
    requestCtrlCExit: input.requestCtrlCExit,
    requestCtrlDExit: input.requestCtrlDExit,
    handleSlashCommand: input.handleSlashCommand,
    inputHistoryStore: input.inputHistoryStore,
    submitQuery: input.submitQuery,
    vimModeEnabled: input.vimModeEnabled,
    terminalHeight: input.terminalHeight,
    terminalWidth: input.terminalWidth,
    buffer: input.buffer,
  };
}

function buildUIStateParamsCore(r: HookResults) {
  const { bootstrap: b, dialogs: d, input: i } = r;
  return {
    config: b.config,
    settings: b.settings,
    settingsNonce: d.settingsNonce,
    terminalWidth: i.terminalWidth,
    terminalHeight: i.terminalHeight,
    inputWidth: i.inputWidth,
    suggestionsWidth: i.suggestionsWidth,
    terminalBackgroundColor: b.config.getTerminalBackground(),
    history: b.history,
    pendingHistoryItems: i.pendingHistoryItems,
    streamingState: i.streamingState,
    thought: i.thought,
    buffer: i.buffer,
    shellModeActive: d.shellModeActive,
    isThemeDialogOpen: d.isThemeDialogOpen,
    isSettingsDialogOpen: d.isSettingsDialogOpen,
    isAuthDialogOpen: d.isAuthDialogOpen,
    isEditorDialogOpen: d.isEditorDialogOpen,
    isProviderDialogOpen: d.isProviderDialogOpen,
    isLoadProfileDialogOpen: d.isLoadProfileDialogOpen,
    isCreateProfileDialogOpen: d.isCreateProfileDialogOpen,
    isProfileListDialogOpen: d.isProfileListDialogOpen,
    isProfileDetailDialogOpen: d.isProfileDetailDialogOpen,
    isProfileEditorDialogOpen: d.isProfileEditorDialogOpen,
    isToolsDialogOpen: d.isToolsDialogOpen,
    isFolderTrustDialogOpen: d.isFolderTrustDialogOpen,
    showWorkspaceMigrationDialog: d.showWorkspaceMigrationDialog,
    showPrivacyNotice: d.showPrivacyNotice,
    isOAuthCodeDialogOpen: d.isOAuthCodeDialogOpen,
    isPermissionsDialogOpen: d.isPermissionsDialogOpen,
    isLoggingDialogOpen: d.isLoggingDialogOpen,
    isSubagentDialogOpen: d.isSubagentDialogOpen,
    isModelsDialogOpen: d.isModelsDialogOpen,
    isSessionBrowserDialogOpen: d.isSessionBrowserDialogOpen,
    providerOptions: d.isCreateProfileDialogOpen
      ? d.createProfileProviders
      : d.providerOptions,
    selectedProvider: d.selectedProvider,
    currentModel: d.currentModel,
    profiles: d.profiles,
    toolsDialogAction: d.toolsDialogAction,
    toolsDialogTools: d.toolsDialogTools,
    toolsDialogDisabledTools: d.toolsDialogDisabledTools,
    workspaceGeminiCLIExtensions: d.workspaceGeminiCLIExtensions,
    loggingDialogData: d.loggingDialogData,
    subagentDialogInitialView: d.subagentDialogInitialView,
    subagentDialogInitialName: d.subagentDialogInitialName,
    modelsDialogData: d.modelsDialogData,
  };
}

function buildUIStateParamsExtra(r: HookResults) {
  const { bootstrap: b, dialogs: d, input: i, layout: l } = r;
  return {
    profileListItems: d.profileListItems,
    selectedProfileName: d.selectedProfileName,
    selectedProfileData: d.selectedProfileData,
    defaultProfileName: d.defaultProfileName,
    activeProfileName: d.activeProfileName,
    profileDialogError: d.profileDialogError,
    profileDialogLoading: d.profileDialogLoading,
    confirmationRequest: i.confirmationRequest,
    confirmUpdateGeminiCLIExtensionRequests: d.confirmUpdateExtensionRequests,
    ctrlCPressedOnce: i.ctrlCPressedOnce,
    ctrlDPressedOnce: i.ctrlDPressedOnce,
    showEscapePrompt: d.showEscapePrompt,
    showIdeRestartPrompt: d.showIdeRestartPrompt,
    quittingMessages: i.quittingMessages,
    constrainHeight: d.constrainHeight,
    showErrorDetails: d.showErrorDetails,
    showToolDescriptions: d.showToolDescriptions,
    isTodoPanelCollapsed: d.isTodoPanelCollapsed,
    isNarrow: b.isNarrow,
    vimModeEnabled: i.vimModeEnabled,
    vimMode: i.vimMode,
    ideContextState: d.ideContextState,
    llxprtMdFileCount: b.llxprtMdFileCount,
    coreMemoryFileCount: b.coreMemoryFileCount,
    mainAreaWidth: l.mainAreaWidth,
    branchName: l.branchName,
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
    isProcessing: d.isProcessing,
    isInputActive: i.isInputActive,
    isFocused: b.isFocused,
    rootUiRef: l.rootUiRef,
    pendingHistoryItemRef: l.pendingHistoryItemRef,
    slashCommands: i.slashCommands,
    commandContext: i.commandContext,
    shouldShowIdePrompt: !!b.shouldShowIdePrompt,
    currentIDE: b.currentIDE,
    isRestarting: d.isRestarting,
    isTrustedFolder: b.config.isTrustedFolder(),
    isWelcomeDialogOpen: d.isWelcomeDialogOpen,
    welcomeState: d.welcomeState,
    welcomeAvailableProviders: d.welcomeAvailableProviders,
    welcomeAvailableModels: d.welcomeAvailableModels,
    inputHistory: i.inputHistoryStore.inputHistory,
    staticKey: d.staticKey,
    debugMessage: d.debugMessage,
    showDebugProfiler: d.showDebugProfiler,
    copyModeEnabled: d.copyModeEnabled,
    footerHeight: d.footerHeight,
    placeholder: l.placeholder,
    availableTerminalHeight: l.availableTerminalHeight,
    queueErrorMessage: d.queueErrorMessage,
    renderMarkdown: d.renderMarkdown,
    activeShellPtyId: i.activeShellPtyId,
    embeddedShellFocused: d.embeddedShellFocused,
  };
}

function buildUIActionsParams(r: HookResults) {
  const { bootstrap: b, dialogs: d, input: i, layout: l } = r;
  return {
    addItem: b.addItem,
    clearItems: b.clearItems,
    loadHistory: b.loadHistory,
    refreshStatic: d.refreshStatic,
    handleUserInputSubmit: i.handleUserInputSubmit,
    handleClearScreen: l.handleClearScreen,
    openThemeDialog: d.openThemeDialog,
    handleThemeSelect: d.handleThemeSelect,
    handleThemeHighlight: d.handleThemeHighlight,
    openSettingsDialog: d.openSettingsDialog,
    closeSettingsDialog: d.closeSettingsDialog,
    handleSettingsRestart: i.handleSettingsRestart,
    openAuthDialog: d.openAuthDialog,
    handleAuthSelect: d.handleAuthSelect,
    handleAuthTimeout: i.handleAuthTimeout,
    openEditorDialog: d.openEditorDialog,
    handleEditorSelect: d.handleEditorSelect,
    exitEditorDialog: d.exitEditorDialog,
    openProviderDialog: d.openProviderDialog,
    handleProviderSelect: d.handleProviderSelect,
    exitProviderDialog: d.exitProviderDialog,
    openLoadProfileDialog: d.openLoadProfileDialog,
    handleProfileSelect: d.handleProfileSelect,
    exitLoadProfileDialog: d.exitLoadProfileDialog,
    openCreateProfileDialog: d.openCreateProfileDialog,
    exitCreateProfileDialog: d.exitCreateProfileDialog,
    openProfileListDialog: d.openProfileListDialog,
    closeProfileListDialog: d.closeProfileListDialog,
    viewProfileDetail: d.viewProfileDetail,
    closeProfileDetailDialog: d.closeProfileDetailDialog,
    loadProfileFromDetail: d.loadProfileFromDetail,
    deleteProfileFromDetail: d.deleteProfileFromDetail,
    setProfileAsDefault: d.setProfileAsDefault,
    openProfileEditor: d.openProfileEditor,
    closeProfileEditor: d.closeProfileEditor,
    saveProfileFromEditor: d.saveProfileFromEditor,
    openToolsDialog: d.openToolsDialog,
    handleToolsSelect: d.handleToolsSelect,
    exitToolsDialog: d.exitToolsDialog,
    handleFolderTrustSelect: d.handleFolderTrustSelect,
    welcomeActions: d.welcomeActions,
    triggerWelcomeAuth: d.triggerWelcomeAuth,
    openPermissionsDialog: d.openPermissionsDialog,
    closePermissionsDialog: d.closePermissionsDialog,
    openLoggingDialog: d.openLoggingDialog,
    closeLoggingDialog: d.closeLoggingDialog,
    openSubagentDialog: d.openSubagentDialog,
    closeSubagentDialog: d.closeSubagentDialog,
    openModelsDialog: d.openModelsDialog,
    closeModelsDialog: d.closeModelsDialog,
    openSessionBrowserDialog: d.openSessionBrowserDialog,
    closeSessionBrowserDialog: d.closeSessionBrowserDialog,
    onWorkspaceMigrationDialogOpen: d.onWorkspaceMigrationDialogOpen,
    onWorkspaceMigrationDialogClose: d.onWorkspaceMigrationDialogClose,
    openPrivacyNotice: d.openPrivacyNotice,
    handlePrivacyNoticeExit: d.handlePrivacyNoticeExit,
    handleOAuthCodeDialogClose: i.handleOAuthCodeDialogClose,
    handleOAuthCodeSubmit: i.handleOAuthCodeSubmit,
    handleConfirmationSelect: l.handleConfirmationSelect,
    handleIdePromptComplete: i.handleIdePromptComplete,
    vimHandleInput: i.vimHandleInput,
    toggleVimEnabled: i.toggleVimEnabled,
    handleSlashCommand: i.handleSlashCommand,
    performMemoryRefresh: d.performMemoryRefresh,
    setShowErrorDetails: d.setShowErrorDetails,
    setShowToolDescriptions: d.setShowToolDescriptions,
    setConstrainHeight: d.setConstrainHeight,
    setShellModeActive: d.setShellModeActive,
    handleEscapePromptChange: d.handleEscapePromptChange,
    cancelOngoingRequest: i.cancelOngoingRequest,
    setQueueErrorMessage: d.setQueueErrorMessage,
  };
}

export const AppContainerRuntime = (props: AppContainerRuntimeProps) => {
  debug.debug('AppContainer architecture active (v2)');
  const bootstrap = useAppBootstrap(props);
  const dialogs = useAppDialogs({
    config: bootstrap.config,
    settings: bootstrap.settings,
    appState: props.appState,
    appDispatch: props.appDispatch,
    addItem: bootstrap.addItem,
    handleNewMessage: bootstrap.handleNewMessage,
    recordingIntegration: bootstrap.recordingIntegration,
    recordingIntegrationRef: bootstrap.recordingIntegrationRef,
    runtime: bootstrap.runtime,
    consoleMessages: bootstrap.consoleMessages,
    setLlxprtMdFileCount: bootstrap.setLlxprtMdFileCount,
  });
  const input = useAppInput(
    buildInputParams(bootstrap, dialogs, props.appState, props.appDispatch),
  );
  const layout = useAppLayout(buildLayoutParams(bootstrap, dialogs, input));
  const r: HookResults = { bootstrap, dialogs, input, layout };
  const uiState = useUIStateBuilder({
    ...buildUIStateParamsCore(r),
    ...buildUIStateParamsExtra(r),
  });
  const uiActions = useUIActionsBuilder(buildUIActionsParams(r));
  return (
    <UIStateProvider value={uiState}>
      <UIActionsProvider value={uiActions}>
        <DefaultAppLayout
          config={bootstrap.config}
          settings={bootstrap.settings}
          startupWarnings={bootstrap.startupWarnings}
          version={props.version}
          nightly={bootstrap.nightly}
          mainControlsRef={layout.mainControlsRef}
          availableTerminalHeight={layout.availableTerminalHeight}
          contextFileNames={layout.contextFileNames}
          updateInfo={bootstrap.updateInfo}
        />
      </UIActionsProvider>
    </UIStateProvider>
  );
};
