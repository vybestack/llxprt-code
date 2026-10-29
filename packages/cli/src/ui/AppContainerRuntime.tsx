import type { CliSessionPersistencePort } from '../cliSessionPersistence.js';
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

import {
  DefaultAppLayout,
  type DefaultAppLayoutProps,
} from './layouts/DefaultAppLayout.js';
import {
  AppCommandsProvider,
  type AppCommandBindings,
} from './contexts/AppCommandsContext.js';
import { TerminalProvider } from './stores/terminal/TerminalContext.js';
import { TurnProvider } from './stores/turn/TurnContext.js';
import { SettingsProfileProvider } from './stores/settings/SettingsContext.js';
import { DialogProvider } from './stores/dialog/DialogContext.js';
import { ToolResultExpansionProvider } from './contexts/ToolResultExpansionContext.js';
import type { RegisteredHistoryReads } from './hooks/useRegisteredHistoryCommands.js';

import type { CredentialCommandRegistration } from './hooks/credentialCommandRegistration.js';

import {
  useGetActiveModelName,
  useGetActiveProfileName,
  useGetActiveProviderName,
  useGetLoadBalancerStats,
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
  RecordingIntegration,
  SessionRecordingPort,
  LockHandle,
  ResumeBootHandle,
} from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type { SessionMetricUpdates } from '@vybestack/llxprt-code-telemetry';
import type {
  BrowserResumeRuntime,
  ContainerAppReads,
  ContainerInputReads,
  ContainerMemoryReads,
  ContainerRuntimeReads,
  ContainerSessionReads,
  ContainerTerminalReads,
} from './cliCommandPorts.js';
import type { UiSubagentManager } from './cliUiRuntime.js';
import type { EmojiFilterSettingsSource } from './utils/iContentToHistoryItems.js';
import type { LayoutRuntime } from './layouts/DefaultAppLayoutHelpers.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../config/settings.js';
import type { AppState, AppAction } from './reducers/appReducer.js';
import type { OperationLifecycleRegistry } from './hooks/agentStream/operationLifecycle.js';
import type { MemoryTelemetryController } from './hooks/memoryTrend/memoryTelemetry.js';
import type {
  AppBootstrapProps,
  AppBootstrapResult,
} from './containers/AppContainer/hooks/useAppBootstrap.js';
import { useAppDialogs } from './containers/AppContainer/hooks/useAppDialogs.js';
import type {
  AppDialogsParams,
  AppDialogsResult,
  AppDialogsRuntime,
} from './containers/AppContainer/hooks/useAppDialogs.js';
import { useAppInput } from './containers/AppContainer/hooks/useAppInput.js';
import type {
  AppInputParams,
  AppInputResult,
} from './containers/AppContainer/hooks/useAppInput.js';
import { useAppLayout } from './containers/AppContainer/hooks/useAppLayout.js';
import { useAppCommands } from './appCommandBindings.js';
import {
  useAppStores,
  useUnconfiguredGuidance,
  type AppStores,
} from './containers/AppContainer/hooks/useAppStores.js';
import type { DialogStore } from './stores/dialog/dialogStore.js';
import type { TerminalStore } from './stores/terminal/terminalStore.js';
import type { TurnStore } from './stores/turn/turnStore.js';
import type { SettingsProfileStore } from './stores/settings/settingsStore.js';

export { useAppStores } from './containers/AppContainer/hooks/useAppStores.js';
import { useRef, useMemo, useCallback } from 'react';
import { useBound } from './hooks/agentStream/useStreamOwnerCallbacks.js';
import { useBrowserCatalogCommands } from './hooks/useBrowserCatalogCommands.js';
import {
  bindOwnerBrowserResume,
  bindRawBrowserResume,
} from './components/browserResumeHost.js';
import type { bindRawBrowserSession } from './components/browserResumeHost.js';
import { resumeOwnerSession } from './utils/resumeOwnerSession.js';
import { useVimMode } from './contexts/VimModeContext.js';
import { useTodoContext } from './contexts/TodoContext.js';
import { useExtensionUpdates } from './hooks/useExtensionUpdates.js';
import { useSlashCommandActions } from './containers/AppContainer/hooks/useSlashCommandActions.js';
import { useStoreSelector } from './stores/useStoreSelector.js';
import type {
  SlashCommandProcessorCoreResult,
  SlashCommandProcessorPorts,
  UseSlashCommandProcessorCoreArgs,
} from './hooks/useSlashCommandProcessorCore.js';
import { useSlashCommandProcessorCore } from './hooks/useSlashCommandProcessorCore.js';
import type { HistoryItem } from './types.js';
import {
  useInputAgentOperations,
  useInputReadOperations,
  useInputStreamPolicy,
  type InputAgentOperations,
  type StreamPolicyReads,
} from './inputOwnerBindings.js';
import { getInteractiveTranscriptPath } from './transcriptPath.js';

const debug = new DebugLogger('llxprt:ui:appcontainer');

export interface AppContainerRuntimeProps
  extends Pick<
    UseSlashCommandProcessorCoreArgs,
    | 'registerIdeCommand'
    | 'readIdeDisplayName'
    | 'readIdeMode'
    | 'readIdeAvailable'
    | 'registerWorkspaceCommands'
    | 'registerChatCommands'
    | 'registerSubagentCommand'
    | 'resumeOwnedCommand'
    | 'bindRawCommandResume'
    | 'recordCommandEvent'
    | 'isMcpDiscoveryPending'
    | 'endCommandSession'
    | 'startNewCommandSession'
    | 'startCommandSession'
    | 'listCommandTools'
  > {
  subscribeBucketConsent?: Agent['auth']['subscribeBucketConsent'];
  respondToBucketConsent?: Agent['auth']['respondToBucketConsent'];
  subscribeHookPhase?: Agent['hooks']['subscribeExecutionPhase'];
  readCurrentIde: AppBootstrapProps['readCurrentIde'];
  readIdeContext: AppDialogsParams['readIdeContext'];
  subscribeIdeContext: AppDialogsParams['subscribeIdeContext'];
  readIdeDiffingEnabled: DefaultAppLayoutProps['readIdeDiffingEnabled'];
  subscribeIdeDiffing: DefaultAppLayoutProps['subscribeIdeDiffing'];
  resolveIdeDiff: DefaultAppLayoutProps['resolveIdeDiff'];
  readIdeWorkspaceTrust: DefaultAppLayoutProps['readIdeWorkspaceTrust'];
  subscribeIdeWorkspaceTrust: DefaultAppLayoutProps['subscribeIdeWorkspaceTrust'];
  triggerSessionStart: AppBootstrapProps['triggerSessionStart'];
  appendHistory: AppBootstrapProps['appendHistory'];
  recordRecordingEvent: AppBootstrapProps['recordRecordingEvent'];
  metrics: SessionMetricUpdates;
  subscribeHistoryTokens: AppBootstrapProps['subscribeHistoryTokens'];
  connectRecordingHistory: Parameters<typeof useBootstrapRuntime>[4];
  readProviderMetrics: AppBootstrapProps['readProviderMetrics'];
  readSessionTokenUsage: AppBootstrapProps['readSessionTokenUsage'];
  historyReads: RegisteredHistoryReads;
  readJournal: AppBootstrapProps['readJournal'];
  subscribeContextRange: DefaultAppLayoutProps['subscribeContextRange'];
  registerCredentials: CredentialCommandRegistration;
  readBuiltinCommands: ReadBuiltinCommands;
  loadRegisteredCommands: LoadRegisteredCommands;
  subscribeCommandChanges: SubscribeCommandChanges;
  containerApp: ContainerAppReads;
  containerSession: ContainerSessionReads;
  containerTerminal: ContainerTerminalReads;
  containerMemory: ContainerMemoryReads;
  containerInput: ContainerInputReads;
  inputPolicy: StreamPolicyReads;
  emojiFilter: EmojiFilterSettingsSource;
  containerRuntime: ContainerRuntimeReads;
  slashCommandPorts: SlashCommandProcessorPorts;
  layoutRuntime: LayoutRuntime;
  dialogsRuntime: AppDialogsRuntime;
  browserSession: BrowserResumeRuntime;
  session: Parameters<typeof useInputBrowserCommands>[0] &
    InputAgentOperations['session'];
  readRawBrowserCatalog: Parameters<typeof useInputBrowserCommands>[4];
  deleteRawBrowserTarget: Parameters<typeof useInputBrowserCommands>[5];
  bindRawBrowserSession: (
    config: Parameters<typeof bindRawBrowserSession>[0],
    swaps: Parameters<typeof bindRawBrowserSession>[2],
    logger: Parameters<typeof bindRawBrowserSession>[3],
  ) => ReturnType<typeof bindRawBrowserSession>;
  isAgentClientPresent: () => boolean;
  readHistory: InputAgentOperations['readHistory'];
  stream: InputAgentOperations['stream'];
  injectSteer: InputAgentOperations['injectSteer'];
  getProviderContextLimit: InputAgentOperations['getProviderContextLimit'];
  getContentPrefixIdentity: InputAgentOperations['getContentPrefixIdentity'];
  tools: InputAgentOperations['tools'];
  mcp: InputAgentOperations['mcp'];
  tasks: InputAgentOperations['tasks'];
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
  resumedBoot?: Pick<ResumeBootHandle, 'streamRows'>;
  version: string;
  terminalBackgroundColor?: string;
  appState: AppState;
  appDispatch: React.Dispatch<AppAction>;
  /** @plan:PLAN-20260211-SESSIONRECORDING.P26 */
  recordingIntegration?: RecordingIntegration;
  recordingOwner?: 'agent' | 'raw';
  /** @plan:PLAN-20260214-SESSIONBROWSER.P23 */
  initialRecordingService?: SessionRecordingPort;
  /** @plan:PLAN-20260214-SESSIONBROWSER.P23 */
  initialLockHandle?: LockHandle | null;
  suppressStartupWelcome?: boolean;
  /** P12: optional perf operation lifecycle registry (perf enabled only). */
  operationLifecycle?: OperationLifecycleRegistry;
  /** P12: optional memory telemetry controller (perf+memory enabled only). */
  memoryController?: MemoryTelemetryController;
}

/** Dialog-data runtime: wiring only; every param is bootstrap/store-owned. */
function useAppDialogsRuntime(
  props: AppContainerRuntimeProps,
  bootstrap: AppBootstrapResult,
  stores: AppStores,
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
    config: props.dialogsRuntime,
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
    readIdeContext: props.readIdeContext,
    subscribeIdeContext: props.subscribeIdeContext,
  });
}

/** Stream operations the input path binds from the agent props. */
function useInputStreamOperations(props: AppContainerRuntimeProps) {
  return useInputAgentOperations({
    readHistory: props.readHistory,
    stream: props.stream,
    appendHistory: props.appendHistory,
    injectSteer: props.injectSteer,
    getProviderContextLimit: props.getProviderContextLimit,
    getContentPrefixIdentity: props.getContentPrefixIdentity,
    tools: props.tools,
    mcp: props.mcp,
    metrics: props.metrics,
    tasks: props.tasks,
    session: props.session,
    recordingOwner: props.recordingOwner,
    recorder: props.recordingIntegration,
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
  const { browserSession: config } = props;
  const browser = useInputBrowserCommands(
    props.session,
    config,
    props.recordingOwner,
    recordingSwapCallbacks,
    props.readRawBrowserCatalog,
    props.deleteRawBrowserTarget,
    props.bindRawBrowserSession,
    turnStore,
    dialogStore,
    commands.commandContext.ui.clear,
  );
  const stream = useInputStreamOperations(props);
  const policy = useInputStreamPolicy(props.inputPolicy);
  return useAppInput({
    ...stream,
    ...policy,
    ...browser,
    commands,
    setQuittingMessagesRef,
    disposeInput: props.disposeInput,
    readJournal: props.readJournal,
    readApprovalMode: props.readApprovalMode,
    setApprovalMode: props.setApprovalMode,
    generatePromptContent: props.generatePromptContent,
    injectInputSteer: props.injectSteer,
    ...useInputReadOperations({
      ...props.containerInput,
      isAgentClientPresent: props.isAgentClientPresent,
      readIdeMode: props.readIdeMode,
      refreshMemory: useBound(
        props.containerRuntime,
        props.containerRuntime.refreshMemory,
      ),
      readDebugMode: useBound(
        props.containerRuntime,
        props.containerRuntime.getDebugMode,
      ),
    }),
    ...inputView,
  });
}

function useAppInputRuntime(
  props: AppContainerRuntimeProps,
  bootstrap: AppBootstrapResult,
  stores: AppStores,
  recordingIntegrationRef: UseRecordingInfrastructureResult['recordingIntegrationRef'],
  recordingSwapCallbacks: UseRecordingInfrastructureResult['recordingSwapCallbacks'],
) {
  const view = useInputCommandView(
    useBound(props.containerRuntime, props.containerRuntime.getExtensions),
    props.containerRuntime.getWorkingDir(),
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
    ports: props.slashCommandPorts,
    registerIdeCommand: props.registerIdeCommand,
    readIdeMode: props.readIdeMode,
    readIdeAvailable: props.readIdeAvailable,
    readIdeDisplayName: props.readIdeDisplayName,
    registerWorkspaceCommands: props.registerWorkspaceCommands,
    registerChatCommands: props.registerChatCommands,
    registerSubagentCommand: props.registerSubagentCommand,
    resumeOwnedCommand: props.resumeOwnedCommand,
    bindRawCommandResume: props.bindRawCommandResume,
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
    props.containerApp.getSubagentManager(),
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

function useBootstrapMemoryReads(memory: ContainerMemoryReads) {
  return {
    readLlxprtMdFileCount: useBound(memory, memory.getLlxprtMdFileCount),
    readCoreMemoryFileCount: useBound(memory, memory.getCoreMemoryFileCount),
  };
}

export const AppContainerRuntime = (props: AppContainerRuntimeProps) => {
  debug.debug('AppContainer architecture active (v2)');
  const { containerApp, containerRuntime, settings } = props;
  const stores = useAppStores(containerRuntime);
  const { recordingIntegrationRef, recordingSwapCallbacks } =
    useRecordingInfrastructure(
      props.initialRecordingService,
      props.recordingIntegration,
      props.initialLockHandle,
      props.recordingOwner,
    );
  const bootstrap = useApplicationBootstrap(
    props,
    stores,
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
  const layout = useApplicationLayout(
    props,
    bootstrap.clearConsoleMessagesState,
    stores,
  );
  return (
    <AppRuntimeView
      subscribeBucketConsent={props.subscribeBucketConsent}
      respondToBucketConsent={props.respondToBucketConsent}
      subscribeHookPhase={props.subscribeHookPhase}
      readIdeMode={props.readIdeMode}
      readIdeDiffingEnabled={props.readIdeDiffingEnabled}
      subscribeIdeDiffing={props.subscribeIdeDiffing}
      resolveIdeDiff={props.resolveIdeDiff}
      readIdeWorkspaceTrust={props.readIdeWorkspaceTrust}
      subscribeIdeWorkspaceTrust={props.subscribeIdeWorkspaceTrust}
      layoutRuntime={props.layoutRuntime}
      version={props.version}
      screenReaderEnabled={containerApp.getScreenReader()}
      disableLoadingPhrases={
        containerApp.getAccessibility().disableLoadingPhrases === true
      }
      debugMode={containerApp.getDebugMode()}
      settings={settings}
      startupWarnings={props.startupWarnings ?? []}
      nightly={bootstrap.nightly}
      updateInfo={bootstrap.updateInfo}
      mainControlsRef={layout.mainControlsRef}
      rootUiRef={layout.rootUiRef}
      pendingHistoryItemRef={layout.pendingHistoryItemRef}
      contextFileNames={layout.contextFileNames}
      subscribeContextRange={props.subscribeContextRange}
      scrollbackPager={bootstrap.scrollbackPager}
      appCommands={useAppCommands(dialogs, input, layout, stores.terminalStore)}
      dialogStore={stores.dialogStore}
      terminalStore={stores.terminalStore}
      turnStore={stores.turnStore}
      settingsStore={stores.settingsStore}
      getTranscriptFilePath={useTranscriptReader(
        props.recordingOwner,
        recordingSwapCallbacks,
        props.readAgentRecordingPath,
      )}
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
          pager={layoutProps.scrollbackPager?.store}
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

function useApplicationLayout(
  {
    containerApp,
    containerSession,
    containerTerminal,
    settings,
  }: AppContainerRuntimeProps,
  clearConsoleMessagesState: AppBootstrapResult['clearConsoleMessagesState'],
  stores: AppStores,
): ReturnType<typeof useAppLayout> {
  return useAppLayout({
    uiRuntime: {
      getDebugMode: containerApp.getDebugMode,
      getTargetDir: containerSession.getTargetDir,
      setPtyTerminalSize: containerTerminal.setPtyTerminalSize,
    },
    settings,
    clearConsoleMessagesState,
    turnStore: stores.turnStore,
    store: stores.dialogStore,
    terminalStore: stores.terminalStore,
    settingsStore: stores.settingsStore,
  });
}

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

function useApplicationBootstrap(
  props: AppContainerRuntimeProps,
  stores: AppStores,
  recordingIntegrationRef: UseRecordingInfrastructureResult['recordingIntegrationRef'],
): AppBootstrapResult {
  const { containerApp, containerMemory, containerTerminal, emojiFilter } =
    props;
  const { metrics, settings } = props;
  return useBootstrapRuntime(
    {
      ...useBootstrapMemoryReads(containerMemory),
      readIdeMode: props.readIdeMode,
      triggerSessionStart: props.triggerSessionStart,
      appendHistory: props.appendHistory,
      recordRecordingEvent: props.recordRecordingEvent,
      setTokenTrackingMetrics: useBound(
        metrics,
        metrics.setTokenTrackingMetrics,
      ),
      readProviderMetrics: props.readProviderMetrics,
      readSessionTokenUsage: props.readSessionTokenUsage,
      subscribeHistoryTokens: props.subscribeHistoryTokens,
      resumedBoot: props.resumedBoot,
      readJournal: props.readJournal,
      readRecordingPath: props.readAgentRecordingPath,
      settings: props.settings,
      version: props.version,
      memoryController: props.memoryController,
    },
    settings.merged,
    stores,
    {
      emojiFilter,
      getTerminalBackground: containerTerminal.getTerminalBackground,
      getDebugMode: containerApp.getDebugMode,
      readCurrentIde: props.readCurrentIde,
    },
    props.connectRecordingHistory,
    props.recordingOwner,
    recordingIntegrationRef,
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
  readRawCatalog: Parameters<typeof useBrowserCatalogCommands>[3],
  deleteRawTarget: CliSessionPersistencePort['deleteBrowserTarget'],
  bindRawSession: AppContainerRuntimeProps['bindRawBrowserSession'],
  turnStore: TurnStore,
  dialogStore: DialogStore,
  clear: () => void,
) {
  const { readBrowserCatalog, deleteBrowserTarget } = useBrowserCatalogCommands(
    session,
    recordingOwner,
    config,
    readRawCatalog,
    (target) =>
      deleteRawTarget(
        target,
        recordingSwapCallbacks?.getCurrentRecording() ?? null,
      ),
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
            session.listBrowserTargetsDetailed.bind(session),
          ),
        clear,
        turnStore.commands.addItem,
        close,
      );
    const logger = new DebugLogger('llxprt:ui:dialogmanager');
    return bindRawBrowserResume(
      bindRawSession(config, recordingSwapCallbacks, logger),
      () => resolveEmojiFilterMode(config),
      clear,
      turnStore.commands.addItem,
      close,
      logger,
    );
  }, [
    session,
    bindRawSession,
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
  readExtensions: () => ReturnType<ContainerRuntimeReads['getExtensions']>,
  workingDir: string,
  stores: AppStores,
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
  const { addItem, clearItems, refreshStatic, setIsProcessing } =
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

function buildInputView(
  stores: AppStores,
  settings: LoadedSettings,
  appState: AppState,
  appDispatch: React.Dispatch<AppAction>,
  operationLifecycle: OperationLifecycleRegistry | undefined,
  subagentManager: UiSubagentManager | undefined,
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
