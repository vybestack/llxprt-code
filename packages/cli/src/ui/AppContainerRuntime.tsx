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
import type { OperationLifecycleRegistry } from './hooks/agentStream/operationLifecycle.js';
import type { MemoryTelemetryController } from './hooks/memoryTrend/memoryTelemetry.js';
import { DefaultAppLayout } from './layouts/DefaultAppLayout.js';
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
import type { AppLayoutResult } from './containers/AppContainer/hooks/useAppLayout.js';
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
  type AppCommands,
} from './contexts/AppCommandsContext.js';
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

function buildInputParams(
  bootstrap: AppBootstrapResult,
  dialogs: AppDialogsResult,
  appState: AppState,
  appDispatch: React.Dispatch<AppAction>,
  slashCommandRuntime: SlashCommandRuntime,
  dialogOpeners: DialogOpeners,
  stores: {
    dialogStore: DialogStore;
    terminalStore: TerminalStore;
    settingsStore: SettingsProfileStore;
    turnStore: TurnStore;
  },
): AppInputParams {
  return {
    streamRuntime: bootstrap.streamRuntime,
    slashCommandRuntime,
    agent: bootstrap.agent,
    settings: bootstrap.settings,
    runtime: bootstrap.runtime,
    subagentManager: bootstrap.uiRuntime.app.getSubagentManager(),
    turnStore: stores.turnStore,
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
    store: stores.dialogStore,
    terminalStore: stores.terminalStore,
    settingsStore: stores.settingsStore,
    openThemeDialog: dialogs.openThemeDialog,
    openProviderDialog: dialogs.openProviderDialog,
    openLoadProfileDialog: dialogs.openLoadProfileDialog,
    openCreateProfileDialog: dialogs.openCreateProfileDialog,
    openProfileListDialog: dialogs.openProfileListDialog,
    viewProfileDetail: dialogs.viewProfileDetail,
    openProfileEditor: dialogs.openProfileEditor,
    setDebugMessage: dialogs.setDebugMessage,
    toggleCorgiMode: dialogs.toggleCorgiMode,
    dispatchExtensionStateUpdate: dialogs.dispatchExtensionStateUpdate,
    addConfirmUpdateExtensionRequest: dialogs.addConfirmUpdateExtensionRequest,
    welcomeActions: dialogs.welcomeActions,
    extensionsUpdateState: dialogs.extensionsUpdateState,
    performMemoryRefresh: dialogs.performMemoryRefresh,
    handleExternalEditorOpen: dialogs.handleExternalEditorOpen,
    // appReducer-held auth state (needsRelogin); dialogs moved to DialogStore.
    appState,
    appDispatch,
  };
}

function buildLayoutParams(
  bootstrap: AppBootstrapResult,
  dialogs: AppDialogsResult,
  input: AppInputResult,
  stores: {
    dialogStore: DialogStore;
    terminalStore: TerminalStore;
    settingsStore: SettingsProfileStore;
    turnStore: TurnStore;
  },
): Parameters<typeof useAppLayout>[0] {
  return {
    uiRuntime: bootstrap.uiRuntime,
    settings: bootstrap.settings,
    consoleMessages: bootstrap.consoleMessages,
    clearConsoleMessagesState: bootstrap.clearConsoleMessagesState,
    turnStore: stores.turnStore,
    store: stores.dialogStore,
    terminalStore: stores.terminalStore,
    settingsStore: stores.settingsStore,
    startupGuardsInitialized: dialogs.startupGuardsInitialized,
    cancelOngoingRequest: input.cancelOngoingRequest,
    requestCtrlCExit: input.requestCtrlCExit,
    requestCtrlDExit: input.requestCtrlDExit,
    handleSlashCommand: input.handleSlashCommand,
    inputHistoryStore: input.inputHistoryStore,
    handleUserInputSubmit: input.handleUserInputSubmit,
    interactiveRuntimeReady: input.interactiveRuntimeReady,
    buffer: input.buffer,
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

/** Same lifetime/StrictMode rules as the terminal store instance. */
function useSettingsProfileStoreInstance(): SettingsProfileStore {
  const settingsStoreRef = useRef<SettingsProfileStore | null>(null);
  settingsStoreRef.current ??= createSettingsProfileStore();
  return settingsStoreRef.current;
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
  settingsStore: SettingsProfileStore,
  turnStore: TurnStore,
): AppDialogsResult {
  return useAppDialogs({
    config: props.slashCommandRuntime,
    agent: props.agent,
    settings: bootstrap.settings,
    store: dialogStore,
    dialogs: dialogOpeners,
    terminalStore,
    settingsStore,
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
 * View-facing command surface: stable callbacks from the domain hooks plus
 * the terminal-store mode commands. Data reads stay in the stores.
 */
export function buildAppCommands(
  dialogs: Pick<AppDialogsResult, keyof AppCommands & keyof AppDialogsResult>,
  input: Pick<AppInputResult, keyof AppCommands & keyof AppInputResult> & {
    inputHistoryStore: Pick<
      AppInputResult['inputHistoryStore'],
      'inputHistory'
    >;
  },
  layout: Pick<AppLayoutResult, 'handleClearScreen'>,
  terminalStore: TerminalStore,
): AppCommands {
  const { commands: terminalCommands } = terminalStore;
  return {
    buffer: input.buffer,
    commandContext: input.commandContext,
    inputHistory: input.inputHistoryStore.inputHistory,
    handleUserInputSubmit: input.handleUserInputSubmit,
    handleSteer: input.handleSteer,
    handleClearScreen: layout.handleClearScreen,
    vimHandleInput: input.vimHandleInput,
    sendAllQueuedSubmissions: input.sendAllQueuedSubmissions,
    steerAllQueuedSubmissions: input.steerAllQueuedSubmissions,
    clearQueuedSubmissions: input.clearQueuedSubmissions,
    setShellModeActive: terminalCommands.setShellModeActive,
    handleEscapePromptChange: terminalCommands.setShowEscapePrompt,
    setQueueErrorMessage: terminalCommands.setQueueErrorMessage,
    onWorkspaceMigrationDialogOpen: dialogs.onWorkspaceMigrationDialogOpen,
    handleIdePromptComplete: input.handleIdePromptComplete,
    handleFolderTrustSelect: dialogs.handleFolderTrustSelect,
    welcomeActions: dialogs.welcomeActions,
    triggerWelcomeAuth: dialogs.triggerWelcomeAuth,
    handleThemeSelect: dialogs.handleThemeSelect,
    handleThemeHighlight: dialogs.handleThemeHighlight,
    handleAuthSelect: dialogs.handleAuthSelect,
    handleOAuthCodeDialogClose: input.handleOAuthCodeDialogClose,
    handleOAuthCodeSubmit: input.handleOAuthCodeSubmit,
    handleEditorSelect: dialogs.handleEditorSelect,
    handleProviderSelect: dialogs.handleProviderSelect,
    handleProfileSelect: (...args) => {
      void dialogs.handleProfileSelect(...args);
    },
    viewProfileDetail: (...args) => {
      void dialogs.viewProfileDetail(...args);
    },
    closeProfileDetailDialog: () => {
      void dialogs.closeProfileDetailDialog();
    },
    loadProfileFromDetail: (...args) => {
      void dialogs.loadProfileFromDetail(...args);
    },
    deleteProfileFromDetail: (...args) => {
      void dialogs.deleteProfileFromDetail(...args);
    },
    deleteProfileFromList: (...args) => {
      void dialogs.deleteProfileFromList(...args);
    },
    setProfileAsDefault: (...args) => {
      void dialogs.setProfileAsDefault(...args);
    },
    openProfileEditor: (...args) => {
      void dialogs.openProfileEditor(...args);
    },
    closeProfileEditor: () => {
      void dialogs.closeProfileEditor();
    },
    saveProfileFromEditor: dialogs.saveProfileFromEditor,
    handleToolsSelect: dialogs.handleToolsSelect,
    handleSettingsRestart: input.handleSettingsRestart,
  };
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
  const settingsStore = useSettingsProfileStoreInstance();
  const bootstrap = useAppBootstrap({
    ...props,
    terminalStore,
    turnStore,
    settingsStore,
  });
  const dialogs = useAppDialogsRuntime(
    props,
    bootstrap,
    dialogStore,
    dialogOpeners,
    terminalStore,
    settingsStore,
    turnStore,
  );
  const stores = { dialogStore, terminalStore, settingsStore, turnStore };
  const input = useAppInput({
    ...buildInputParams(
      bootstrap,
      dialogs,
      props.appState,
      props.appDispatch,
      props.slashCommandRuntime,
      dialogOpeners,
      stores,
    ),
    operationLifecycle: props.operationLifecycle,
  });
  const layout: AppLayoutResult = useAppLayout(
    buildLayoutParams(bootstrap, dialogs, input, stores),
  );
  useUnconfiguredGuidance(props, turnStore, dialogStore);
  const appCommands = useMemo(
    () => buildAppCommands(dialogs, input, layout, terminalStore),
    [dialogs, input, layout, terminalStore],
  );
  return (
    <TerminalProvider store={terminalStore}>
      <TurnProvider store={turnStore}>
        <SettingsProfileProvider store={settingsStore}>
          <DialogProvider store={dialogStore}>
            <AppCommandsProvider value={appCommands}>
              <DefaultAppLayout
                uiRuntime={bootstrap.uiRuntime}
                slashCommandRuntime={props.slashCommandRuntime}
                settings={bootstrap.settings}
                startupWarnings={bootstrap.startupWarnings}
                version={props.version}
                nightly={bootstrap.nightly}
                mainControlsRef={layout.mainControlsRef}
                rootUiRef={layout.rootUiRef}
                pendingHistoryItemRef={layout.pendingHistoryItemRef}
                contextFileNames={layout.contextFileNames}
                updateInfo={bootstrap.updateInfo}
              />
            </AppCommandsProvider>
          </DialogProvider>
        </SettingsProfileProvider>
      </TurnProvider>
    </TerminalProvider>
  );
};
