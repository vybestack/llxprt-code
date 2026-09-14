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
  type AppCommandBindings,
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
    suppressStartupWelcome: props.suppressStartupWelcome,
    shouldShowIdePrompt: bootstrap.shouldShowIdePrompt,
    currentIDE: bootstrap.currentIDE,
  });
}

/**
 * Current domain bindings, including changing input snapshots. The provider
 * separates these snapshots from the stable view-facing command callbacks.
 */
export function buildAppCommands(
  dialogs: Pick<
    AppDialogsResult,
    keyof AppCommandBindings & keyof AppDialogsResult
  >,
  input: Pick<
    AppInputResult,
    keyof AppCommandBindings & keyof AppInputResult
  > & {
    inputHistoryStore: Pick<
      AppInputResult['inputHistoryStore'],
      'inputHistory'
    >;
  },
  layout: Pick<AppLayoutResult, 'handleClearScreen'>,
  terminalStore: TerminalStore,
): AppCommandBindings {
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

function useAppCommands(
  dialogs: AppDialogsResult,
  input: AppInputResult,
  layout: AppLayoutResult,
  terminalStore: TerminalStore,
): AppCommandBindings {
  return useMemo(
    () => buildAppCommands(dialogs, input, layout, terminalStore),
    [dialogs, input, layout, terminalStore],
  );
}

export const AppContainerRuntime = (props: AppContainerRuntimeProps) => {
  debug.debug('AppContainer architecture active (v2)');
  const {
    dialogStore,
    terminalStore,
    turnStore,
    settingsStore,
    dialogOpeners,
  } = useAppStores(props.slashCommandRuntime);
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
  const input = useAppInput({
    uiRuntime: props.uiRuntime,
    streamRuntime: bootstrap.streamRuntime,
    slashCommandRuntime: props.slashCommandRuntime,
    agent: props.agent,
    settings: props.settings,
    runtime: bootstrap.runtime,
    subagentManager: props.uiRuntime.app.getSubagentManager(),
    turnStore,
    recordingIntegrationRef: bootstrap.recordingIntegrationRef,
    recordingSwapCallbacks: bootstrap.recordingSwapCallbacks,
    recordingIntegration: props.recordingIntegration,
    runtimeMessageBus: props.runtimeMessageBus,
    setIdePromptAnswered: bootstrap.setIdePromptAnswered,
    setLlxprtMdFileCount: bootstrap.setLlxprtMdFileCount,
    dialogs: dialogOpeners,
    store: dialogStore,
    terminalStore,
    settingsStore,
    appState: props.appState,
    appDispatch: props.appDispatch,
    operationLifecycle: props.operationLifecycle,
  });
  const layout = useAppLayout({
    uiRuntime: bootstrap.uiRuntime,
    settings: props.settings,
    clearConsoleMessagesState: bootstrap.clearConsoleMessagesState,
    turnStore,
    store: dialogStore,
    terminalStore,
    settingsStore,
  });
  useUnconfiguredGuidance(props, turnStore, dialogStore);
  const appCommands = useAppCommands(dialogs, input, layout, terminalStore);
  return (
    <AppRuntimeView
      runtimeMessageBus={props.runtimeMessageBus}
      slashCommandRuntime={props.slashCommandRuntime}
      version={props.version}
      uiRuntime={bootstrap.uiRuntime}
      settings={bootstrap.settings}
      startupWarnings={bootstrap.startupWarnings}
      nightly={bootstrap.nightly}
      updateInfo={bootstrap.updateInfo}
      mainControlsRef={layout.mainControlsRef}
      rootUiRef={layout.rootUiRef}
      pendingHistoryItemRef={layout.pendingHistoryItemRef}
      contextFileNames={layout.contextFileNames}
      appCommands={appCommands}
      dialogStore={dialogStore}
      terminalStore={terminalStore}
      turnStore={turnStore}
      settingsStore={settingsStore}
    />
  );
};

interface AppRuntimeViewProps extends DefaultAppLayoutProps {
  appCommands: AppCommandBindings;
  dialogStore: DialogStore;
  terminalStore: TerminalStore;
  turnStore: TurnStore;
  settingsStore: SettingsProfileStore;
}

function AppRuntimeView({
  appCommands,
  dialogStore,
  terminalStore,
  turnStore,
  settingsStore,
  ...layoutProps
}: AppRuntimeViewProps): React.ReactNode {
  return (
    <TerminalProvider store={terminalStore}>
      <TurnProvider store={turnStore}>
        <SettingsProfileProvider store={settingsStore}>
          <DialogProvider store={dialogStore}>
            <AppCommandsProvider value={appCommands}>
              <DefaultAppLayout {...layoutProps} />
            </AppCommandsProvider>
          </DialogProvider>
        </SettingsProfileProvider>
      </TurnProvider>
    </TerminalProvider>
  );
}
