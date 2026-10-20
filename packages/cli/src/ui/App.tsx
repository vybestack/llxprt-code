/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createIdeCommand } from './commands/ideCommand.js';
import { bindIdeCommand } from './commands/ideCommandHost.js';
import { generateAutoPrompt } from './utils/autoPromptGenerator.js';
import { createWorkspaceCommandOwners } from './hooks/workspaceCommandOwners.js';
import { bindDirectoryChangeRecording } from './commands/directoryCommandHost.js';
import {
  bindChatOwnerOperations,
  bindPersistedChatRecording,
} from './commands/chatCommandHost.js';
import { createChatOwnerCommand } from './commands/chatOwnerCommand.js';
import { createChatCommand } from './commands/chatCommand.js';
import { createContinueRegistration } from './hooks/useContinueCommand.js';
import { createSubagentCommand } from './commands/subagentCommand.js';
import { bindSubagentCommand } from './commands/subagentCommandHost.js';
import { resolveEmojiFilterMode } from './utils/iContentToHistoryItems.js';
import { resumeOwnerSession } from './utils/resumeOwnerSession.js';
import { importOwnerSession } from './utils/ownerSessionUi.js';
import { basename } from 'node:path';
import type {
  RegisterWorkspaceCommands,
  RegisterChatCommands,
  RegisterSubagentCommand,
  ResumeOwnedCommand,
} from './hooks/commandSessionOperations.js';
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

import { bindRawBrowserSession } from './components/browserResumeHost.js';
import { bindCommandRawResume } from './hooks/commandRawResumeHost.js';
import { performResume } from '../services/performResume.js';
import { slashCommandLogger } from './hooks/slashCommandProcessor.js';
import { SettingScope } from '../config/settings.js';
import {
  createCredentialRegistration,
  createModelRegistration,
  createProfileRegistration,
  createQuotaRegistration,
  type CredentialCommandRegistration,
} from './hooks/credentialCommandRegistration.js';
import {
  createMcpOwnerCommand,
  createAuthOwnerCommand,
  createBaseurlRegistration,
  createLogoutRegistration,
  createKeyfileRegistration,
  createKeyRegistration,
  createToolkeyCommands,
} from './hooks/credentialRegistrars.js';

import { AppProviders, AppWithState } from './app-providers.js';
import { Component, type ReactNode } from 'react';
import {
  getProjectHash,
  type IContent,
  type RecordingIntegration,
  type SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import type { SlashCommandRuntime, UiRuntime } from './cliUiRuntime.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../config/settings.js';
import type { OperationLifecycleRegistry } from './hooks/agentStream/operationLifecycle.js';
import type { MemoryTelemetryController } from './hooks/memoryTrend/memoryTelemetry.js';
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
import { type ProviderAliasRefresh } from './contexts/ProviderAliasRefreshContext.js';
import { type OAuthControl } from './contexts/OAuthControlContext.js';
import { type AppContainerProps } from './AppContainer.js';
import { bindPolicyRulesReader } from './hooks/policyRulesReaderHost.js';
import {
  createCliModelIdentityRuntime,
  resolveContentPrefixIdentity,
} from './utils/modelIdentity.js';

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
  /** @plan:PLAN-20260211-SESSIONRECORDING.P26 */
  recordingIntegration?: RecordingIntegration;
  recordingOwner?: 'agent' | 'raw';
  /** @plan:PLAN-20260214-SESSIONBROWSER.P23 */
  initialRecordingService?: SessionRecordingService;
  /** @plan:PLAN-20260214-SESSIONBROWSER.P23 */
  initialLockHandle?: AppContainerProps['initialLockHandle'];
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
  #uiSource: UiRuntime | undefined;
  #uiView: AppContainerProps['uiRuntime'] | undefined;
  private readonly isAgentClientPresent = (): boolean => true;
  private readonly subscribeHistoryTokens: AppContainerProps['subscribeHistoryTokens'] =
    (publish) => this.props.agent.session.subscribeHistoryTokens(publish);
  private readonly connectRecordingHistory: AppContainerProps['connectRecordingHistory'] =
    (recording) =>
      this.props.agent.session.connectRecordingHistory(() => recording.current);
  private readonly readRawBrowserCatalog: AppContainerProps['readRawBrowserCatalog'] =
    async () => {
      const persistence = this.props.slashCommandRuntime.sessionPersistence;
      if (!persistence)
        throw new Error('CLI session persistence is unavailable');
      const listing = await persistence.listBrowserTargetsDetailed();
      return {
        ...listing,
        skippedCount: listing.unreadableRecordings.length,
        currentSessionId: this.props.slashCommandRuntime.getSessionId(),
      };
    };
  private readonly deleteRawBrowserTarget: AppContainerProps['deleteRawBrowserTarget'] =
    (target, recording) => {
      const persistence = this.props.slashCommandRuntime.sessionPersistence;
      if (!persistence)
        throw new Error('CLI session persistence is unavailable');
      return persistence.deleteBrowserTarget(target, recording);
    };
  private readonly bindRawBrowserSession: AppContainerProps['bindRawBrowserSession'] =
    (config, swaps, logger) =>
      bindRawBrowserSession(config, this.props.agent.session, swaps, logger);
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
  #recordingPathAgent: Agent | undefined;
  #readAgentRecordingPath: (() => string | undefined) | undefined;
  #autoPromptAgent: Agent | undefined;
  #generateSubagentPrompt:
    | AppContainerProps['generateSubagentPrompt']
    | undefined;
  readonly #toolkeys = createToolkeyCommands();

  private readAgentRecordingPath(): () => string | undefined {
    if (this.#recordingPathAgent !== this.props.agent) {
      const session = this.props.agent.session;
      this.#recordingPathAgent = this.props.agent;
      this.#readAgentRecordingPath = () => session.getRecording().path;
    }
    if (this.#readAgentRecordingPath === undefined)
      throw new Error('Agent recording reader was not initialized');
    return this.#readAgentRecordingPath;
  }

  private readonly appendHistory: AppContainerProps['appendHistory'] = (
    ...args
  ) => this.props.agent.addHistory(...args);
  private readonly readHistory: AppContainerProps['readHistory'] = (...args) =>
    this.props.agent.getHistory(...args);
  private readonly stream: AppContainerProps['stream'] = (...args) =>
    this.props.agent.stream(...args);
  private readonly injectSteer: AppContainerProps['injectSteer'] = (...args) =>
    this.props.agent.injectSteer(...args);
  private readonly getProviderContextLimit: AppContainerProps['getProviderContextLimit'] =
    (...args) => this.props.agent.getProviderContextLimit(...args);
  private readonly disposeInput: AppContainerProps['disposeInput'] = () =>
    this.props.agent.dispose();
  private readonly readApprovalMode: AppContainerProps['readApprovalMode'] =
    () => this.props.agent.getApprovalMode();
  private readonly setApprovalMode: AppContainerProps['setApprovalMode'] = (
    ...args
  ) => this.props.agent.setApprovalMode(...args);
  private readonly readProviderMetrics: AppContainerProps['readProviderMetrics'] =
    () => this.props.agent.providerReads.getActiveProviderMetrics();
  private readonly readSessionTokenUsage: AppContainerProps['readSessionTokenUsage'] =
    () => this.props.agent.providerReads.getSessionTokenUsage();
  private readonly readPolicyRules: AppContainerProps['readPolicyRules'] = () =>
    bindPolicyRulesReader(this.props.agent.policy, () =>
      this.props.slashCommandRuntime.getApprovalMode(),
    )();
  private readonly getContentPrefixIdentity: AppContainerProps['getContentPrefixIdentity'] =
    () => {
      try {
        return resolveContentPrefixIdentity(
          createCliModelIdentityRuntime(this.props.agent),
        );
      } catch {
        return null;
      }
    };

  #generateText: Agent['generate'] | undefined;

  private generateText(): Agent['generate'] {
    if (this.#autoPromptAgent !== this.props.agent) {
      const generate = this.props.agent.generate.bind(this.props.agent);
      this.#generateText = generate;
      this.#generateSubagentPrompt = (description) =>
        generateAutoPrompt(description, generate);
      this.#autoPromptAgent = this.props.agent;
    }
    if (this.#generateText === undefined)
      throw new Error('Text generation operation was not initialized');
    return this.#generateText;
  }

  private generateSubagentPrompt(): AppContainerProps['generateSubagentPrompt'] {
    this.generateText();
    if (this.#generateSubagentPrompt === undefined)
      throw new Error('Subagent prompt operation was not initialized');
    return this.#generateSubagentPrompt;
  }

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
    const mcp = this.props.agent.mcp;
    return createCommandChangeSubscription(
      (listener) => this.props.agent.ide.subscribeConnection(() => listener()),
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
        await a.session.replaceHistory(history);
      },
      bindRawCommandResume: ((config, callbacks) =>
        bindCommandRawResume(
          config,
          config?.sessionPersistence,
          a.session,
          callbacks,
          slashCommandLogger,
          performResume,
        )) satisfies AppContainerProps['bindRawCommandResume'],
      recordCommandEvent: session.recordRecordingEvent.bind(session),
      isMcpDiscoveryPending: () => a.mcp.discoveryState() === 'pending',
      endCommandSession: a.hooks.triggerSessionEnd.bind(a.hooks),
      startNewCommandSession: session.startNewSession.bind(session),
      startCommandSession: a.hooks.triggerSessionStart.bind(a.hooks),
      listCommandTools: a.tools.list.bind(a.tools),
      subscribeBucketConsent: a.auth.subscribeBucketConsent.bind(a.auth),
      respondToBucketConsent: a.auth.respondToBucketConsent.bind(a.auth),
      subscribeHookPhase: a.hooks.subscribeExecutionPhase.bind(a.hooks),
    };
  }
  private readonly readIdeMode: AppContainerProps['readIdeMode'] = () =>
    this.props.agent.ide.getIdeMode();
  private readonly readCurrentIde: AppContainerProps['readCurrentIde'] = () =>
    this.props.agent.ide.readConnection().currentIde;
  private readonly readIdeContext: AppContainerProps['readIdeContext'] = () =>
    this.props.agent.ide.readContext();
  private readonly subscribeIdeContext: AppContainerProps['subscribeIdeContext'] =
    (listener) => this.props.agent.ide.subscribeContext(listener);
  private readonly readIdeWorkspaceTrust: AppContainerProps['readIdeWorkspaceTrust'] =
    () => this.props.agent.ide.readWorkspaceTrust();
  private readonly subscribeIdeWorkspaceTrust: AppContainerProps['subscribeIdeWorkspaceTrust'] =
    (listener) => this.props.agent.ide.subscribeWorkspaceTrust(listener);
  private readonly readIdeDisplayName: AppContainerProps['readIdeDisplayName'] =
    () =>
      this.props.agent.ide.getIdeMode()
        ? (this.props.agent.ide.readConnection().detectedIdeDisplayName ?? '')
        : '';
  private readonly readIdeAvailable: AppContainerProps['readIdeAvailable'] =
    () => this.props.agent.ide.readConnection().available;
  private readonly readIdeDiffingEnabled: AppContainerProps['readIdeDiffingEnabled'] =
    () => {
      const connection = this.props.agent.ide.readConnection();
      return connection.available ? connection.diffingEnabled : null;
    };
  private readonly subscribeIdeDiffing: AppContainerProps['subscribeIdeDiffing'] =
    (listener) => this.props.agent.ide.subscribeConnection(() => listener());
  private readonly resolveIdeDiff: AppContainerProps['resolveIdeDiff'] = (
    ...args
  ) => this.props.agent.ide.resolveDiff(...args);
  private readonly registerIdeCommand: AppContainerProps['registerIdeCommand'] =
    (addItem) => {
      const ide = this.props.agent.ide;
      return createIdeCommand(
        bindIdeCommand(
          ide.readConnection.bind(ide),
          ide.readContext.bind(ide),
          ide.setIdeMode.bind(ide),
          ide.setIdeClientConnected.bind(ide),
          ide.setIdeClientDisconnected.bind(ide),
          this.props.settings,
          addItem,
        ),
      );
    };

  private registerWorkspaceCommands(): RegisterWorkspaceCommands {
    const a = this.props.agent;
    const c = this.props.slashCommandRuntime;
    return (add, setMemory, owner, raw) =>
      createWorkspaceCommandOwners(
        c,
        a.tools.list.bind(a.tools),
        a.getEphemeralSetting.bind(a),
        a.setEphemeralSetting.bind(a),
        add,
        setMemory,
        async () => {
          await a.sessionClient.publishTools();
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
        a.addDirectoryContext.bind(a),
        bindDirectoryChangeRecording(
          owner,
          a.session.recordRecordingEvent.bind(a.session),
          raw?.recordDirectoriesChanged.bind(raw),
        ),
        a.sessionClient.runImageOperation.bind(a.sessionClient),
        () => a.session.readInitializedHistory() ?? undefined,
        this.readIdeDisplayName,
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
    const persistence = () => {
      if (!c.sessionPersistence)
        throw new Error('CLI session persistence is unavailable');
      return c.sessionPersistence;
    };
    return (mode, raw, swaps, fuzzy) => ({
      chatCommand:
        mode === 'agent'
          ? createChatOwnerCommand(owner, fuzzy)
          : createChatCommand(
              bindPersistedChatRecording(
                persistence,
                () =>
                  swaps?.getCurrentRecording() ??
                  raw?.getRecordingService() ??
                  null,
                () => getProjectHash(c.getProjectRoot()),
                () => c.projectChatsDir,
                s.readInitializedHistory.bind(s),
                s.replaceHistory.bind(s),
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
        () => persistence().listBrowserTargetsDetailed(),
        mode,
      ),
    });
  }
  private registerSubagentCommand(): RegisterSubagentCommand {
    const a = this.props.agent;
    const generate = this.generateText();
    return (fuzzy, add) =>
      createSubagentCommand(
        bindSubagentCommand(
          a.workspace.subagentDefinitions,
          a.workspace.subagentWrites,
          () => a.workspace.profileDefinitions.listProfiles(),
          fuzzy,
          (description) => generateAutoPrompt(description, generate),
          true,
          add,
        ),
      );
  }

  private bindHistory(): RegisteredHistoryReads {
    const a = this.props.agent;
    return {
      compressHistory: (...args) => a.compress(...args),
      readRawHistory: () => a.session.readHistorySnapshot()?.messages ?? null,
      isHistoryInitialized: a.session.isHistoryInitialized.bind(a.session),
      readHistory: () => a.getHistory(),
      replaceHistory: async (items) => {
        await a.session.replaceHistory(items);
      },
      readDumpHistory: a.session.readHistorySnapshot.bind(a.session),
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

  private renderAppWithState(
    registerCredentials: CredentialCommandRegistration,
  ): ReactNode {
    const { agent, uiRuntime, ...props } = this.props;
    if (this.#uiSource !== uiRuntime) {
      this.#uiSource = uiRuntime;
      this.#uiView = uiRuntime;
    }
    if (
      !this.#uiView ||
      !this.#registry ||
      !this.#history ||
      !this.#sessionCommands
    )
      throw new Error('Application operations were not initialized');
    return (
      <AppWithState
        {...props}
        uiRuntime={this.#uiView}
        readCurrentIde={this.readCurrentIde}
        readIdeContext={this.readIdeContext}
        subscribeIdeContext={this.subscribeIdeContext}
        readIdeDisplayName={this.readIdeDisplayName}
        readIdeAvailable={this.readIdeAvailable}
        registerIdeCommand={this.registerIdeCommand}
        readIdeMode={this.readIdeMode}
        readIdeDiffingEnabled={this.readIdeDiffingEnabled}
        subscribeIdeDiffing={this.subscribeIdeDiffing}
        resolveIdeDiff={this.resolveIdeDiff}
        readIdeWorkspaceTrust={this.readIdeWorkspaceTrust}
        subscribeIdeWorkspaceTrust={this.subscribeIdeWorkspaceTrust}
        isAgentClientPresent={this.isAgentClientPresent}
        {...this.#registry}
        {...this.#sessionCommands}
        session={agent.session}
        readRawBrowserCatalog={this.readRawBrowserCatalog}
        deleteRawBrowserTarget={this.deleteRawBrowserTarget}
        bindRawBrowserSession={this.bindRawBrowserSession}
        readHistory={this.readHistory}
        stream={this.stream}
        appendHistory={this.appendHistory}
        injectSteer={this.injectSteer}
        getProviderContextLimit={this.getProviderContextLimit}
        getContentPrefixIdentity={this.getContentPrefixIdentity}
        tools={agent.tools}
        mcp={agent.mcp}
        metrics={agent.metrics}
        tasks={agent.tasks}
        disposeInput={this.disposeInput}
        readApprovalMode={this.readApprovalMode}
        setApprovalMode={this.setApprovalMode}
        generatePromptContent={this.generateText()}
        readPolicyRules={this.readPolicyRules}
        subagentDefinitions={agent.workspace.subagentDefinitions}
        subagentWrites={agent.workspace.subagentWrites}
        profileDefinitions={agent.workspace.profileDefinitions}
        triggerSessionStart={this.#sessionCommands.startCommandSession}
        recordRecordingEvent={this.#sessionCommands.recordCommandEvent}
        subscribeHistoryTokens={this.subscribeHistoryTokens}
        connectRecordingHistory={this.connectRecordingHistory}
        readProviderMetrics={this.readProviderMetrics}
        readSessionTokenUsage={this.readSessionTokenUsage}
        historyReads={this.#history}
        registerCredentials={registerCredentials}
        readAgentRecordingPath={this.readAgentRecordingPath()}
        generateSubagentPrompt={this.generateSubagentPrompt()}
      />
    );
  }

  override render() {
    const props = this.props;
    const registerCredentials = this.capture();

    return (
      <AppProviders
        metrics={props.agent.metrics}
        screenReaderEnabled={props.uiRuntime.app.getScreenReader()}
        settings={props.settings}
        sessionId={props.uiRuntime.session.getSessionId()}
        renderRuntime={props.renderRuntime}
        oauthControl={props.oauthControl}
        providerAliasRefresh={props.providerAliasRefresh}
      >
        {this.renderAppWithState(registerCredentials)}
      </AppProviders>
    );
  }
}

// Re-export for backwards compatibility
export { AppContainer } from './AppContainer.js';
