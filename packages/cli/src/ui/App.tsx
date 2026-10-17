/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createWorkspaceCommandOwners } from './hooks/workspaceCommandOwners.js';
import { bindDirectoryChangeRecording } from './commands/directoryCommandHost.js';
import {
  bindChatOwnerOperations,
  bindChatRecordingOperations,
} from './commands/chatCommandHost.js';
import { createChatOwnerCommand } from './commands/chatOwnerCommand.js';
import { createChatCommand } from './commands/chatCommand.js';
import { createContinueRegistration } from './hooks/useContinueCommand.js';
import { createSubagentCommand } from './commands/subagentCommand.js';
import {
  bindSubagentCommand,
  bindAutoPromptOperation,
} from './commands/subagentCommandHost.js';
import { resolveEmojiFilterMode } from './utils/iContentToHistoryItems.js';
import { resumeOwnerSession } from './utils/resumeOwnerSession.js';
import { importOwnerSession } from './utils/ownerSessionUi.js';
import { basename } from 'node:path';
import { getProjectHash } from '@vybestack/llxprt-code-core';
import type {
  RegisterWorkspaceCommands,
  RegisterChatCommands,
  RegisterSubagentCommand,
  ResumeOwnedCommand,
} from './hooks/commandSessionOperations.js';
import type { UseSlashCommandProcessorCoreArgs } from './hooks/useSlashCommandProcessorCore.js';
import {
  createBuiltinCommandLoaderFactory,
  createRegisteredCommandLoader,
  createCommandChangeSubscription,
  type ReadBuiltinCommands,
  type LoadRegisteredCommands,
  type SubscribeCommandChanges,
} from '../services/commandRegistryOperations.js';
import { McpPromptLoader } from '../services/McpPromptLoader.js';
import { createHeadlessCommandLoader } from '../nonInteractiveBindings.js';

import type { RegisteredHistoryReads } from './hooks/useRegisteredHistoryCommands.js';

import { SettingScope } from '../config/settings.js';
import {
  createCredentialRegistration,
  createModelRegistration,
  createProfileRegistration,
  createQuotaRegistration,
} from './hooks/credentialCommandRegistration.js';
import type { CredentialCommandRegistration } from './hooks/credentialCommandRegistration.js';
import {
  createMcpOwnerCommand,
  createAuthOwnerCommand,
  createBaseurlRegistration,
  createLogoutRegistration,
  createKeyfileRegistration,
  createKeyRegistration,
  createToolkeyCommands,
} from './hooks/credentialRegistrars.js';

import { Component, useReducer } from 'react';
import type {
  IContent,
  RecordingIntegration,
  SessionRecordingService,
  LockHandle,
  MessageBus,
} from '@vybestack/llxprt-code-core';
import type { SlashCommandRuntime, UiRuntime } from './cliUiRuntime.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../config/settings.js';
import type { OperationLifecycleRegistry } from './hooks/agentStream/operationLifecycle.js';
import type { MemoryTelemetryController } from './hooks/memoryTrend/memoryTelemetry.js';
import { KeypressProvider } from './contexts/KeypressContext.js';
import { MouseProvider } from './contexts/MouseContext.js';
import { SessionStatsProvider } from './contexts/SessionContext.js';
import { VimModeProvider } from './contexts/VimModeContext.js';
import { TodoProvider } from './contexts/TodoProvider.js';
import type {
  DetectProviderQuotaOperation,
  FetchOperation,
  GetActiveModelNameOperation,
  GetActiveProviderAliasConfigOperation,
  GetActiveProviderNameOperation,
  GetActiveToolFormatStateOperation,
  GetEphemeralSettingOperation,
  GetEphemeralSettingsOperation,
  ListSavedProfilesOperation,
  ProviderStatusOperation,
  SaveLoadBalancerProfileOperation,
  SetActiveModelOperation,
  SetActiveToolFormatOverrideOperation,
  SetEphemeralSettingOperation,
  UpdateActiveProviderApiKeyOperation,
} from './contexts/RuntimeContext.js';
import type { ReactNode } from 'react';
import { OverflowProvider } from './contexts/OverflowContext.js';
import {
  ProviderAliasRefreshProvider,
  type ProviderAliasRefresh,
} from './contexts/ProviderAliasRefreshContext.js';
import {
  OAuthControlProvider,
  type OAuthControl,
} from './contexts/OAuthControlContext.js';
import { AppDispatchProvider } from './contexts/AppDispatchContext.js';
import { ScrollProvider } from './contexts/ScrollProvider.js';
import { ShellCommandDisplayProvider } from './contexts/ShellCommandDisplayContext.js';
import { inkRenderOptions } from './inkRenderOptions.js';
import { isMouseEventsEnabled } from './mouseEventsEnabled.js';
import { appReducer, initialAppState } from './reducers/appReducer.js';
import { AppContainer } from './AppContainer.js';

interface AppProps {
  uiRuntime: UiRuntime;
  slashCommandRuntime: SlashCommandRuntime;
  /**
   * The single interactive Agent created at the CLI composition root.
   */
  agent: Agent;
  renderRuntime: (children: ReactNode) => ReactNode;
  detectProviderQuota: DetectProviderQuotaOperation;
  fetch: FetchOperation;
  getActiveModelName: GetActiveModelNameOperation;
  getActiveProviderAliasConfig: GetActiveProviderAliasConfigOperation;
  getActiveProviderName: GetActiveProviderNameOperation;
  getActiveToolFormatState: GetActiveToolFormatStateOperation;
  getEphemeralSetting: GetEphemeralSettingOperation;
  getEphemeralSettings: GetEphemeralSettingsOperation;
  listSavedProfiles: ListSavedProfilesOperation;
  providerStatus: ProviderStatusOperation;
  saveLoadBalancerProfile: SaveLoadBalancerProfileOperation;
  setActiveModel: SetActiveModelOperation;
  setActiveToolFormatOverride: SetActiveToolFormatOverrideOperation;
  setEphemeralSetting: SetEphemeralSettingOperation;
  updateActiveProviderApiKey: UpdateActiveProviderApiKeyOperation;
  providerAliasRefresh: ProviderAliasRefresh;
  oauthControl: OAuthControl;
  settings: LoadedSettings;
  startupWarnings?: string[];
  resumedHistory?: IContent[];
  version: string;
  terminalBackgroundColor?: string;
  runtimeMessageBus?: MessageBus;
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

/**
 * AppWrapper is the main entry point for the CLI UI.
 * It sets up the provider stack that wraps the AppContainer.
 *
 * Provider stack (outermost to innermost):
 * - KeypressProvider: Terminal keypress handling with Kitty/Vim support
 * - SessionStatsProvider: Session statistics tracking
 * - VimModeProvider: Vim mode state management
 * - TodoProvider: Todo list management
 * - RuntimeContextProvider: Runtime API access
 * - OverflowProvider: Overflow detection for UI
 * - AppDispatchProvider: App state dispatch
 * - AppContainer: Main UI container with UIState/UIActions contexts
 */
export class AppWrapper extends Component<AppProps> {
  #captured: AppProps | undefined;
  #registry:
    | {
        readBuiltinCommands: ReadBuiltinCommands;
        loadRegisteredCommands: LoadRegisteredCommands;
        subscribeCommandChanges: SubscribeCommandChanges;
      }
    | undefined;
  #sessionCommands:
    | ReturnType<AppWrapper['registerSessionCommands']>
    | undefined;
  #history: RegisteredHistoryReads | undefined;
  #registration: CredentialCommandRegistration | undefined;
  readonly #toolkeys = createToolkeyCommands();

  private capture() {
    const props = this.props;
    if (
      this.#captured?.agent !== props.agent ||
      this.#captured.slashCommandRuntime !== props.slashCommandRuntime
    )
      this.#registry = this.registerRegistry();
    if (this.#captured?.agent !== props.agent) {
      this.#history = this.bindHistory();
    }
    if (
      this.#captured?.agent !== props.agent ||
      this.#captured.slashCommandRuntime !== props.slashCommandRuntime
    )
      this.#sessionCommands = this.registerSessionCommands();
    const keys = [
      'agent',
      'slashCommandRuntime',
      'oauthControl',
      'settings',
      'providerAliasRefresh',
      'renderRuntime',
      'detectProviderQuota',
      'fetch',
      'getActiveModelName',
      'getActiveProviderAliasConfig',
      'getActiveProviderName',
      'getActiveToolFormatState',
      'getEphemeralSetting',
      'getEphemeralSettings',
      'listSavedProfiles',
      'providerStatus',
      'saveLoadBalancerProfile',
      'setActiveModel',
      'setActiveToolFormatOverride',
      'setEphemeralSetting',
      'updateActiveProviderApiKey',
    ] satisfies Array<keyof AppProps>;
    if (keys.some((key) => this.#captured?.[key] !== props[key])) {
      this.#registration = this.register();
      this.#captured = props;
    }
    if (this.#registration === undefined)
      throw new Error('Application commands were not registered');
    return this.#registration;
  }

  private registerRegistry() {
    const c = this.props.slashCommandRuntime;
    const createBuiltin = createBuiltinCommandLoaderFactory(
      () => c.getEnableHooksUI() === true,
      () => c.isSkillsSupportEnabled() === true,
      () => c.isAdminSkillsEnabled() !== false,
      () => {
        const manager = c.extensionEnablementManager;
        return manager ? (name, path) => manager.isEnabled(name, path) : null;
      },
    );
    return {
      readBuiltinCommands: (owners: Parameters<ReadBuiltinCommands>[0]) =>
        createBuiltin(owners).loadCommandsSync(),
      loadRegisteredCommands: createRegisteredCommandLoader(
        createBuiltin,
        () =>
          new McpPromptLoader({
            getMcpServers: () => c.getMcpServers(),
            listPrompts: (server) => c.listPrompts(server),
          }),
        this.registryFiles(),
      ),
      subscribeCommandChanges: this.registrySubscription(),
    };
  }

  private registryFiles() {
    const c = this.props.slashCommandRuntime;
    return createHeadlessCommandLoader(
      () => c.userCommandsDir,
      () => c.projectCommandsDir,
      () => c.getProjectRoot(),
      () => c.getExtensions(),
      () => c.getFolderTrust(),
      () => () => c.isTrustedFolder(),
      () => c.getShellReplacement(),
      () => c.getExcludeTools(),
      () => c.getCoreTools(),
      () => c.getApprovalMode(),
      () => c.getShellExecutionConfig(),
      () => c.getTargetDir(),
      () => c.getShouldUseNodePtyShell(),
    );
  }

  private registrySubscription() {
    const c = this.props.slashCommandRuntime;
    const mcp = this.props.agent.mcp;
    return createCommandChangeSubscription(
      (listener) => {
        const client = c.getIdeClient();
        client?.addStatusChangeListener(listener);
        return () => client?.removeStatusChangeListener(listener);
      },
      (listener) => mcp.subscribeStatus(listener),
    );
  }

  private registerSessionCommands() {
    const a = this.props.agent;
    const c = this.props.slashCommandRuntime;
    const session = a.session;
    const resumeOwnedCommand: ResumeOwnedCommand = (action) => {
      const mode = resolveEmojiFilterMode(c);
      return action.sessionPackage === undefined
        ? resumeOwnerSession(
            session.resume.bind(session),
            action.sessionRef,
            mode,
            session.listBrowserTargetsDetailed.bind(session),
          )
        : importOwnerSession(
            session.importSession.bind(session),
            action.sessionPackage.packageDirectory,
            mode,
            session.getHistory.bind(session),
          );
    };
    return {
      registerWorkspaceCommands: this.registerWorkspaceCommands(),
      registerChatCommands: this.registerChatCommands(),
      registerSubagentCommand: this.registerSubagentCommand(),
      resumeOwnedCommand,
      replaceCommandHistory: async (
        history: Parameters<Agent['setHistory']>[0],
      ) => {
        await a.setHistory(history);
      },
      readCommandHistoryService: () => a.agentClient.getHistoryService(),
      recordCommandEvent: session.recordRecordingEvent.bind(session),
      isMcpDiscoveryPending: () => a.mcp.discoveryState() === 'pending',
      endCommandSession: a.hooks.triggerSessionEnd.bind(a.hooks),
      startNewCommandSession: session.startNewSession.bind(session),
      startCommandSession: a.hooks.triggerSessionStart.bind(a.hooks),
      listCommandTools: a.tools.list.bind(a.tools),
    };
  }
  private registerWorkspaceCommands(): RegisterWorkspaceCommands {
    const a = this.props.agent;
    const c = this.props.slashCommandRuntime;
    const client = a.agentClient;
    return (add, setMemory, owner, raw) =>
      createWorkspaceCommandOwners(
        c,
        a.tools.list.bind(a.tools),
        a.getEphemeralSetting.bind(a),
        a.setEphemeralSetting.bind(a),
        add,
        setMemory,
        async () => {
          await client.setTools();
        },
        a.policy.getRules.bind(a.policy),
        a.policy.getDefaultDecision.bind(a.policy),
        a.policy.isNonInteractive.bind(a.policy),
        a.hooks.listHooks.bind(a.hooks),
        a.hooks.enable.bind(a.hooks),
        a.hooks.disable.bind(a.hooks),
        a.hooks.setDisabledHooks.bind(a.hooks),
        a.tasks.list.bind(a.tasks),
        a.tasks.listRunning.bind(a.tasks),
        a.tasks.get.bind(a.tasks),
        a.tasks.cancel.bind(a.tasks),
        client.addDirectoryContext.bind(client),
        bindDirectoryChangeRecording(
          owner,
          a.session.recordRecordingEvent.bind(a.session),
          raw?.recordDirectoriesChanged.bind(raw),
        ),
        a.sessionClient.runImageOperation.bind(a.sessionClient),
        () =>
          client.hasChatInitialized()
            ? client.getChat().getHistory()
            : undefined,
      );
  }
  private registerChatCommands(): RegisterChatCommands {
    const a = this.props.agent;
    const c = this.props.slashCommandRuntime;
    const s = a.session;
    const owner = bindChatOwnerOperations(
      s.listCheckpoints.bind(s),
      s.createCheckpoint.bind(s),
      s.resume.bind(s),
      s.deleteCheckpoint.bind(s),
      s.renameCheckpoint.bind(s),
      s.getHistory.bind(s),
      s.clearHistory.bind(s),
      s.restoreTurns.bind(s),
      s.nameCurrentSession.bind(s),
      () => s.getRecording().path,
      () => a.getModel(),
      () => resolveEmojiFilterMode(c),
    );
    const client = a.agentClient;
    return (mode, raw, swaps, fuzzy) => ({
      chatCommand:
        mode === 'agent'
          ? createChatOwnerCommand(owner, fuzzy)
          : createChatCommand(
              bindChatRecordingOperations(
                () =>
                  swaps?.getCurrentRecording() ??
                  raw?.getRecordingService() ??
                  null,
                () => getProjectHash(c.getProjectRoot()),
                () => c.projectChatsDir,
                () => client.mediaStore,
                () =>
                  client.hasChatInitialized()
                    ? client.getChat().getHistory()
                    : null,
                async (history) => {
                  await client.getChat().setHistory(history);
                },
                () => c.getModel(),
              ),
              fuzzy,
            ),
      continueCommand: createContinueRegistration(
        s.exportSession.bind(s),
        () => c.isInteractive(),
        s.listBrowserTargets.bind(s),
        () => c.projectChatsDir,
        () => basename(c.projectTempDir),
        client.mediaStore,
        mode,
      ),
    });
  }
  private registerSubagentCommand(): RegisterSubagentCommand {
    const a = this.props.agent;
    const c = this.props.slashCommandRuntime;
    const generate = bindAutoPromptOperation(
      () => a.getProvider(),
      () => a.agentClient,
      a.sessionClient.createDetachedAgentClient.bind(a.sessionClient),
      () => c.getContentGeneratorConfig(),
    );
    return (fuzzy, add) =>
      createSubagentCommand(
        bindSubagentCommand(
          a.workspace.subagentDefinitions,
          a.workspace.subagentWrites,
          () => a.workspace.profileDefinitions.listProfiles(),
          fuzzy,
          generate,
          true,
          add,
        ),
      );
  }

  private bindHistory(): RegisteredHistoryReads {
    const a = this.props.agent;
    return {
      compressHistory: (...args) => a.compress(...args),
      readRawHistory: () =>
        a.agentClient.getHistoryService()?.getRawHistory() ?? null,
      isHistoryInitialized: () => a.agentClient.hasChatInitialized(),
      readHistory: () => a.getHistory(),
      replaceHistory: async (items) => {
        await a.setHistory(items);
      },
      readDumpHistory: () => {
        const service = a.agentClient.getHistoryService();
        return service == null
          ? null
          : {
              messages: service.getAll(),
              chronology: service.getChronologyTrace(),
            };
      },
    };
  }
  private models() {
    const { agent: a } = this.props;
    return createModelRegistration(
      this.props.setActiveModel,
      this.props.getActiveToolFormatState,
      this.props.setActiveToolFormatOverride,
      this.props.getActiveProviderName,
      this.props.providerStatus,
      this.props.getActiveModelName,
      this.props.getActiveProviderAliasConfig,
      (name, options) => a.setProvider(name, undefined, options),
      this.props.providerAliasRefresh,
    );
  }
  private profiles() {
    const { agent: a, oauthControl: oauth, settings } = this.props;
    const b = <O, A extends unknown[], R>(
      owner: O,
      op: (this: O, ...args: A) => R,
    ): ((...args: A) => R) => op.bind(owner);
    return createProfileRegistration(
      b(
        a.workspace.profileDefinitions,
        a.workspace.profileDefinitions.listProfiles,
      ),
      () => a.getProvider(),
      b(oauth, oauth.listBuckets),
      () => settings.merged.enableFuzzyFiltering ?? true,
      (name, additional) => a.saveProfileSnapshot(name, additional),
      this.props.listSavedProfiles,
      this.props.getEphemeralSettings,
      this.props.saveLoadBalancerProfile,
      b(a.profiles, a.profiles.load),
      async () => {
        await a.mcp.refresh();
      },
      () => a.getProvider(),
      () => a.getModel(),
      (name) => a.deleteProfileByName(name),
      async (name) => {
        a.setDefaultProfileName(name);
        settings.setValue(
          SettingScope.User,
          'defaultProfile',
          name ?? undefined,
        );
      },
    );
  }
  private quota() {
    const oauth = this.props.oauthControl;
    const b = <O, A extends unknown[], R>(
      owner: O,
      op: (this: O, ...args: A) => R,
    ): ((...args: A) => R) => op.bind(owner);
    return createQuotaRegistration(
      this.props.getEphemeralSetting,
      this.props.getActiveProviderName,
      this.props.detectProviderQuota,
      this.props.fetch,
      b(oauth, oauth.isAvailable),
      b(oauth, oauth.getAllAnthropicUsageInfo),
      b(oauth, oauth.getAllCodexUsageInfo),
      b(oauth, oauth.getAllCodexRateLimitResetCredits),
      b(oauth, oauth.hasCodexToken),
      b(oauth, oauth.listBuckets),
      b(oauth, oauth.readCodexBucketToken),
    );
  }
  private mcp() {
    const { agent: a, settings } = this.props;
    const b = <O, A extends unknown[], R>(
      owner: O,
      op: (this: O, ...args: A) => R,
    ): ((...args: A) => R) => op.bind(owner);
    return (
      addItem: Parameters<CredentialCommandRegistration>[0],
      reload: () => void,
    ) =>
      createMcpOwnerCommand(
        b(a.mcp, a.mcp.listServers),
        b(a.mcp, a.mcp.listBlockedServers),
        b(a.mcp, a.mcp.discoveryState),
        b(a.mcp, a.mcp.details),
        b(a.mcp, a.mcp.authenticate),
        b(a.mcp, a.mcp.reload),
        b(a.mcp, a.mcp.refresh),
        true,
        settings,
        addItem,
        reload,
      );
  }
  private register(): CredentialCommandRegistration {
    const {
      agent: a,
      slashCommandRuntime: c,
      oauthControl: oauth,
      settings,
    } = this.props;
    const b = <O, A extends unknown[], R>(
      owner: O,
      op: (this: O, ...args: A) => R,
    ): ((...args: A) => R) => op.bind(owner);
    return createCredentialRegistration(
      this.models(),
      this.profiles(),
      createBaseurlRegistration(
        () => a.getProvider(),
        b(a.auth, a.auth.setBaseUrl),
      ),
      createLogoutRegistration(
        () => a.listProviders(),
        b(a.auth, a.auth.status),
        b(a.auth, a.auth.logout),
      ),
      createKeyfileRegistration(
        this.props.providerStatus,
        this.props.updateActiveProviderApiKey,
        this.props.setEphemeralSetting,
        b(settings, settings.setProviderKeyfile),
        b(settings, settings.removeProviderKeyfile),
      ),
      createKeyRegistration(
        b(c, c.getProviderKeys),
        b(c, c.listKeyCompletionNames),
        b(c, c.invalidateKeyCompletion),
        b(c, c.isInteractive),
        this.props.providerStatus,
        this.props.updateActiveProviderApiKey,
        b(c, c.setEphemeralSetting),
      ),
      createAuthOwnerCommand(oauth, settings),
      this.quota(),
      this.mcp(),
      this.#toolkeys,
      b(a.session, a.session.recordRecordingEvent),
    );
  }

  override render() {
    const props = this.props;
    const registerCredentials = this.capture();
    if (this.#registry === undefined)
      throw new Error('Application command discovery was not registered');
    if (this.#history === undefined)
      throw new Error('Application history was not registered');
    if (this.#sessionCommands === undefined)
      throw new Error('Application session commands were not registered');
    const renderOptions = inkRenderOptions(props.uiRuntime.app, props.settings);
    const mouseEventsEnabled = isMouseEventsEnabled(
      renderOptions,
      props.settings,
    );

    return (
      <KeypressProvider>
        <MouseProvider mouseEventsEnabled={mouseEventsEnabled}>
          <ScrollProvider>
            <SessionStatsProvider metrics={props.agent.metrics}>
              <VimModeProvider settings={props.settings}>
                <ShellCommandDisplayProvider
                  alwaysDisplayFullShellCommand={
                    props.settings.merged.ui.alwaysDisplayFullShellCommand ??
                    true
                  }
                >
                  <TodoProvider
                    sessionId={props.uiRuntime.session.getSessionId()}
                  >
                    {props.renderRuntime(
                      <OAuthControlProvider control={props.oauthControl}>
                        <ProviderAliasRefreshProvider
                          refresh={props.providerAliasRefresh}
                        >
                          <OverflowProvider>
                            <AppWithState
                              {...props}
                              {...this.#registry}
                              {...this.#sessionCommands}
                              historyReads={this.#history}
                              registerCredentials={registerCredentials}
                            />
                          </OverflowProvider>
                        </ProviderAliasRefreshProvider>
                      </OAuthControlProvider>,
                    )}
                  </TodoProvider>
                </ShellCommandDisplayProvider>
              </VimModeProvider>
            </SessionStatsProvider>
          </ScrollProvider>
        </MouseProvider>
      </KeypressProvider>
    );
  }
}

/**
 * AppWithState manages the app reducer state and wraps AppContainer.
 */
const AppWithState = (
  props: AppProps &
    Pick<
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
    > & { historyReads: RegisteredHistoryReads } & {
      registerCredentials: CredentialCommandRegistration;
      readBuiltinCommands: ReadBuiltinCommands;
      loadRegisteredCommands: LoadRegisteredCommands;
      subscribeCommandChanges: SubscribeCommandChanges;
    },
) => {
  const [appState, appDispatch] = useReducer(appReducer, initialAppState);

  return (
    <AppDispatchProvider value={appDispatch}>
      <AppContainer {...props} appState={appState} appDispatch={appDispatch} />
    </AppDispatchProvider>
  );
};

// Re-export for backwards compatibility
export { AppContainer } from './AppContainer.js';
