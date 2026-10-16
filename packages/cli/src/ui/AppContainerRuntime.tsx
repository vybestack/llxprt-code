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
  type AppCommands,
} from './contexts/AppCommandsContext.js';
import { ToolResultExpansionProvider } from './contexts/ToolResultExpansionContext.js';
import { useRef, useMemo, useCallback } from 'react';
import { useBound } from './hooks/agentStream/useStreamOwnerCallbacks.js';
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
  dialogStore: DialogStore,
  dialogOpeners: DialogOpeners,
  terminalStore: TerminalStore,
  settingsStore: SettingsProfileStore,
  turnStore: TurnStore,
): AppDialogsResult {
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
  props: AppContainerRuntimeProps,
  bootstrap: AppBootstrapResult,
  dialogStore: DialogStore,
  dialogOpeners: DialogOpeners,
  terminalStore: TerminalStore,
  turnStore: TurnStore,
  settingsStore: SettingsProfileStore,
): AppInputResult {
  return useAppInput({
    uiRuntime: props.uiRuntime,
    streamRuntime: props.uiRuntime,
    slashCommandRuntime: props.slashCommandRuntime,
    agent: props.agent,
    settings: props.settings,
    subagentManager: props.uiRuntime.app.getSubagentManager(),
    turnStore,
    recordingIntegrationRef: bootstrap.recordingIntegrationRef,
    recordingSwapCallbacks: bootstrap.recordingSwapCallbacks,
    recordingIntegration: props.recordingIntegration,
    recordingOwner: bootstrap.recordingOwner,
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
}

/**
 * Current domain bindings, including changing input snapshots. The provider
 * separates these snapshots from the stable view-facing command callbacks.
 */
function subagentDialogCommands(
  dialogs: Pick<
    AppCommands,
    | 'listSubagentDefinitions'
    | 'loadSubagentDefinition'
    | 'saveSubagentDefinition'
    | 'deleteSubagentDefinition'
    | 'listSubagentProfiles'
    | 'generateSubagentPrompt'
  >,
) {
  return {
    listSubagentDefinitions: dialogs.listSubagentDefinitions,
    loadSubagentDefinition: dialogs.loadSubagentDefinition,
    saveSubagentDefinition: dialogs.saveSubagentDefinition,
    deleteSubagentDefinition: dialogs.deleteSubagentDefinition,
    listSubagentProfiles: dialogs.listSubagentProfiles,
    generateSubagentPrompt: dialogs.generateSubagentPrompt,
  };
}

type DialogViewCommands = Pick<
  AppDialogsResult,
  keyof AppCommandBindings & keyof AppDialogsResult
>;

export function buildAppCommands(
  dialogs: DialogViewCommands,
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
    generatePromptContent: input.generatePromptContent,
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
    resumeBrowserTarget: input.resumeBrowserTarget,
    readBrowserCatalog: input.readBrowserCatalog,
    deleteBrowserTarget: input.deleteBrowserTarget,
    recordModelSwitch: dialogs.recordModelSwitch,
    readPolicyRules: dialogs.readPolicyRules,
    ...subagentDialogCommands(dialogs),
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

function useBootstrapRuntime(
  props: AppContainerRuntimeProps,
  terminalStore: TerminalStore,
  turnStore: TurnStore,
  settingsStore: SettingsProfileStore,
): AppBootstrapResult {
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
  const {
    dialogStore,
    terminalStore,
    turnStore,
    settingsStore,
    dialogOpeners,
  } = useAppStores(props.slashCommandRuntime);
  const bootstrap = useBootstrapRuntime(
    props,
    terminalStore,
    turnStore,
    settingsStore,
  );
  const dialogs = useAppDialogsRuntime(
    props,
    bootstrap,
    dialogStore,
    dialogOpeners,
    terminalStore,
    settingsStore,
    turnStore,
  );
  const input = useAppInputRuntime(
    props,
    bootstrap,
    dialogStore,
    dialogOpeners,
    terminalStore,
    turnStore,
    settingsStore,
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
  return (
    <AppRuntimeView
      runtimeMessageBus={props.runtimeMessageBus}
      slashCommandRuntime={props.slashCommandRuntime}
      version={props.version}
      screenReaderEnabled={props.uiRuntime.app.getScreenReader()}
      disableLoadingPhrases={
        props.uiRuntime.app.getAccessibility().disableLoadingPhrases === true
      }
      debugMode={props.uiRuntime.app.getDebugMode()}
      settings={bootstrap.settings}
      startupWarnings={bootstrap.startupWarnings}
      nightly={bootstrap.nightly}
      updateInfo={bootstrap.updateInfo}
      mainControlsRef={layout.mainControlsRef}
      rootUiRef={layout.rootUiRef}
      pendingHistoryItemRef={layout.pendingHistoryItemRef}
      contextFileNames={layout.contextFileNames}
      appCommands={useAppCommands(dialogs, input, layout, terminalStore)}
      dialogStore={dialogStore}
      terminalStore={terminalStore}
      turnStore={turnStore}
      settingsStore={settingsStore}
      getTranscriptFilePath={() =>
        getInteractiveTranscriptPath(
          bootstrap.recordingOwner,
          () => props.agent.session.getRecording().path,
          () =>
            bootstrap.recordingSwapCallbacks
              ?.getCurrentRecording()
              ?.getFilePath() ?? undefined,
        )
      }
    />
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
