/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createIdeCommand } from '../ui/commands/ideCommand.js';
import { bindIdeCommand } from '../ui/commands/ideCommandHost.js';
import { generateAutoPrompt } from '../ui/utils/autoPromptGenerator.js';
import {
  createWorkspaceCommandOwners,
  type WorkspaceCommandRuntime,
} from '../ui/hooks/workspaceCommandOwners.js';
import { bindDirectoryChangeRecording } from '../ui/commands/directoryCommandHost.js';
import {
  bindChatOwnerOperations,
  bindPersistedChatRecording,
} from '../ui/commands/chatCommandHost.js';
import { createChatOwnerCommand } from '../ui/commands/chatOwnerCommand.js';
import { createChatCommand } from '../ui/commands/chatCommand.js';
import { createContinueRegistration } from '../ui/hooks/useContinueCommand.js';
import { createSubagentCommand } from '../ui/commands/subagentCommand.js';
import { bindSubagentCommand } from '../ui/commands/subagentCommandHost.js';
import { resolveEmojiFilterMode } from '../ui/utils/iContentToHistoryItems.js';
import { resumeOwnerSession } from '../ui/utils/resumeOwnerSession.js';
import { importOwnerSession } from '../ui/utils/ownerSessionUi.js';
import { basename } from 'node:path';
import type {
  RegisterWorkspaceCommands,
  RegisterChatCommands,
  RegisterSubagentCommand,
  ResumeOwnedCommand,
} from '../ui/hooks/commandSessionOperations.js';
import {
  type AppCommandRegistry,
  createAppCommandRegistry,
} from '../ui/appCommandRegistry.js';

import type { RegisteredHistoryReads } from '../ui/hooks/useRegisteredHistoryCommands.js';

import { bindRawBrowserSession } from '../ui/components/browserResumeHost.js';
import { bindCommandRawResume } from '../ui/hooks/commandRawResumeHost.js';
import { performResume } from '../services/performResume.js';
import { slashCommandLogger } from '../ui/hooks/slashCommandProcessor.js';
import { SettingScope } from '../config/settings.js';
import {
  createCredentialRegistration,
  createModelRegistration,
  createProfileRegistration,
  createQuotaRegistration,
  type CredentialCommandRegistration,
} from '../ui/hooks/credentialCommandRegistration.js';
import {
  createMcpOwnerCommand,
  createAuthOwnerCommand,
  createBaseurlRegistration,
  createLogoutRegistration,
  createKeyfileRegistration,
  createKeyRegistration,
  createToolkeyCommands,
} from '../ui/hooks/credentialRegistrars.js';

import type { AppProps } from '../ui/App.js';
import type { ReactNode } from 'react';
import {
  getProjectHash,
  type ApprovalMode,
  type IContent,
  type RecordingIntegration,
  type SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import type {
  BrowserResumeRuntime,
  ChatCommandReads,
  CommandRegistryReads,
  ContainerAppReads,
  ContainerInputReads,
  ContainerMemoryReads,
  ContainerRuntimeReads,
  ContainerSessionReads,
  ContainerTerminalReads,
  FileCommandReads,
  KeyCommandReads,
} from '../ui/cliCommandPorts.js';
import type { StreamPolicyReads } from '../ui/inputOwnerBindings.js';
import type { SlashCommandProcessorPorts } from '../ui/hooks/useSlashCommandProcessorCore.js';
import type { LayoutRuntime } from '../ui/layouts/DefaultAppLayoutHelpers.js';
import type { AppDialogsRuntime } from '../ui/containers/AppContainer/hooks/useAppDialogs.js';
import type { EmojiFilterSettingsSource } from '../ui/utils/iContentToHistoryItems.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../config/settings.js';
import type { OperationLifecycleRegistry } from '../ui/hooks/agentStream/operationLifecycle.js';
import type { MemoryTelemetryController } from '../ui/hooks/memoryTrend/memoryTelemetry.js';
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
} from '../ui/contexts/RuntimeContext.js';
import { type ProviderAliasRefresh } from '../ui/contexts/ProviderAliasRefreshContext.js';
import { type OAuthControl } from '../ui/contexts/OAuthControlContext.js';
import { type AppContainerProps } from '../ui/AppContainer.js';
import { bindPolicyRulesReader } from '../ui/hooks/policyRulesReaderHost.js';
import {
  createCliModelIdentityRuntime,
  resolveContentPrefixIdentity,
} from '../ui/utils/modelIdentity.js';

export interface InteractiveApplicationInputs {
  containerApp: ContainerAppReads;
  containerSession: ContainerSessionReads;
  containerTerminal: ContainerTerminalReads;
  containerMemory: ContainerMemoryReads;
  containerInput: ContainerInputReads;
  inputPolicy: StreamPolicyReads;
  commandRegistry: CommandRegistryReads;
  fileCommands: FileCommandReads;
  workspaceCommands: WorkspaceCommandRuntime;
  chatCommands: ChatCommandReads;
  keyCommands: KeyCommandReads;
  approval: { getApprovalMode(): ApprovalMode };
  browserSession: BrowserResumeRuntime;
  emojiFilter: EmojiFilterSettingsSource;
  containerRuntime: ContainerRuntimeReads;
  slashCommandPorts: SlashCommandProcessorPorts;
  layoutRuntime: LayoutRuntime;
  dialogsRuntime: AppDialogsRuntime;
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

/** Assembles session-owned operations before any UI consumer is mounted. */
export class InteractiveApplication {
  readonly props: InteractiveApplicationInputs;

  constructor(inputs: InteractiveApplicationInputs) {
    this.props = inputs;
    this.#registry = this.registerRegistry();
    this.#history = this.bindHistory();
    this.#sessionCommands = this.registerSessionCommands();
    this.#registration = this.register();
  }
  private readonly isAgentClientPresent = (): boolean => true;
  private readonly subscribeHistoryTokens: AppContainerProps['subscribeHistoryTokens'] =
    (publish) => this.props.agent.session.subscribeHistoryTokens(publish);
  private readonly connectRecordingHistory: AppContainerProps['connectRecordingHistory'] =
    (recording) =>
      this.props.agent.session.connectRecordingHistory(() => recording.current);
  private readonly readRawBrowserCatalog: AppContainerProps['readRawBrowserCatalog'] =
    async () => {
      const persistence = this.props.browserSession.sessionPersistence;
      if (!persistence)
        throw new Error('CLI session persistence is unavailable');
      const listing = await persistence.listBrowserTargetsDetailed();
      return {
        ...listing,
        skippedCount: listing.unreadableRecordings.length,
        currentSessionId: this.props.browserSession.getSessionId(),
      };
    };
  private readonly deleteRawBrowserTarget: AppContainerProps['deleteRawBrowserTarget'] =
    (target, recording) => {
      const persistence = this.props.browserSession.sessionPersistence;
      if (!persistence)
        throw new Error('CLI session persistence is unavailable');
      return persistence.deleteBrowserTarget(target, recording);
    };
  private readonly bindRawBrowserSession: AppContainerProps['bindRawBrowserSession'] =
    (config, swaps, logger) =>
      bindRawBrowserSession(config, this.props.agent.session, swaps, logger);
  readonly #registry: AppCommandRegistry;
  readonly #sessionCommands: ReturnType<
    InteractiveApplication['registerSessionCommands']
  >;
  readonly #history: RegisteredHistoryReads;
  readonly #registration: CredentialCommandRegistration;
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
      this.props.approval.getApprovalMode(),
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

  private registerRegistry() {
    return createAppCommandRegistry(
      this.props.commandRegistry,
      this.props.fileCommands,
      this.props.agent.ide,
      this.props.agent.mcp,
    );
  }

  private registerSessionCommands() {
    const a = this.props.agent;
    const emojiFilter = this.props.emojiFilter;
    const session = a.session;
    const resumeOwnedCommand: ResumeOwnedCommand = (action) => {
      const mode = resolveEmojiFilterMode(emojiFilter);
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
    const workspaceRuntime = this.props.workspaceCommands;
    return (add, setMemory, owner, raw) =>
      createWorkspaceCommandOwners({
        workspace: workspaceRuntime,
        writes: { addItem: add, setMemoryFileCount: setMemory },
        policies: {
          readRules: a.policy.getRules.bind(a.policy),
          readDefaultDecision: a.policy.getDefaultDecision.bind(a.policy),
          readNonInteractive: a.policy.isNonInteractive.bind(a.policy),
        },
        hooks: {
          list: a.hooks.listHooks.bind(a.hooks),
          enable: a.hooks.enable.bind(a.hooks),
          disable: a.hooks.disable.bind(a.hooks),
          setDisabled: a.hooks.setDisabledHooks.bind(a.hooks),
        },
        tasks: {
          list: a.tasks.list.bind(a.tasks),
          listRunning: a.tasks.listRunning.bind(a.tasks),
          get: a.tasks.get.bind(a.tasks),
          cancel: a.tasks.cancel.bind(a.tasks),
        },
        tools: {
          list: a.tools.list.bind(a.tools),
          readSetting: a.getEphemeralSetting.bind(a),
          writeSetting: a.setEphemeralSetting.bind(a),
          refreshSchema: async () => {
            await a.sessionClient.publishTools();
          },
        },
        directory: {
          addDirectoryContext: a.addDirectoryContext.bind(a),
          recordDirectoriesChanged: bindDirectoryChangeRecording(
            owner,
            a.session.recordRecordingEvent.bind(a.session),
            raw?.recordDirectoriesChanged.bind(raw),
          ),
        },
        image: {
          runImageOperation: a.sessionClient.runImageOperation.bind(
            a.sessionClient,
          ),
        },
        bug: {
          getConversationHistory: () =>
            a.session.readInitializedHistory() ?? undefined,
          readIdeName: this.readIdeDisplayName,
        },
      });
  }
  private registerChatCommands(): RegisterChatCommands {
    const a = this.props.agent;
    const c = this.props.chatCommands;
    const emojiFilter = this.props.emojiFilter;
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
      () => resolveEmojiFilterMode(emojiFilter),
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
      keyCommands: c,
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

  private presentationProps(): Pick<
    AppProps,
    | 'containerApp'
    | 'containerSession'
    | 'containerTerminal'
    | 'containerMemory'
    | 'containerInput'
    | 'inputPolicy'
    | 'emojiFilter'
    | 'containerRuntime'
    | 'slashCommandPorts'
    | 'layoutRuntime'
    | 'dialogsRuntime'
    | 'browserSession'
    | 'settings'
    | 'startupWarnings'
    | 'resumedHistory'
    | 'version'
    | 'terminalBackgroundColor'
    | 'recordingIntegration'
    | 'recordingOwner'
    | 'initialRecordingService'
    | 'initialLockHandle'
    | 'suppressStartupWelcome'
    | 'operationLifecycle'
    | 'memoryController'
    | 'renderRuntime'
    | 'oauthControl'
    | 'providerAliasRefresh'
  > {
    const props = this.props;
    return {
      containerApp: props.containerApp,
      containerSession: props.containerSession,
      containerTerminal: props.containerTerminal,
      containerMemory: props.containerMemory,
      containerInput: props.containerInput,
      inputPolicy: props.inputPolicy,
      emojiFilter: props.emojiFilter,
      containerRuntime: props.containerRuntime,
      slashCommandPorts: props.slashCommandPorts,
      layoutRuntime: props.layoutRuntime,
      dialogsRuntime: props.dialogsRuntime,
      browserSession: props.browserSession,
      settings: props.settings,
      startupWarnings: props.startupWarnings,
      resumedHistory: props.resumedHistory,
      version: props.version,
      terminalBackgroundColor: props.terminalBackgroundColor,
      recordingIntegration: props.recordingIntegration,
      recordingOwner: props.recordingOwner,
      initialRecordingService: props.initialRecordingService,
      initialLockHandle: props.initialLockHandle,
      suppressStartupWelcome: props.suppressStartupWelcome,
      operationLifecycle: props.operationLifecycle,
      memoryController: props.memoryController,
      renderRuntime: props.renderRuntime,
      oauthControl: props.oauthControl,
      providerAliasRefresh: props.providerAliasRefresh,
    };
  }

  private buildContainerProps(
    registerCredentials: CredentialCommandRegistration,
  ): AppProps {
    const { agent } = this.props;
    return {
      ...this.presentationProps(),
      readCurrentIde: this.readCurrentIde,
      readIdeContext: this.readIdeContext,
      subscribeIdeContext: this.subscribeIdeContext,
      readIdeDisplayName: this.readIdeDisplayName,
      readIdeAvailable: this.readIdeAvailable,
      registerIdeCommand: this.registerIdeCommand,
      readIdeMode: this.readIdeMode,
      readIdeDiffingEnabled: this.readIdeDiffingEnabled,
      subscribeIdeDiffing: this.subscribeIdeDiffing,
      resolveIdeDiff: this.resolveIdeDiff,
      readIdeWorkspaceTrust: this.readIdeWorkspaceTrust,
      subscribeIdeWorkspaceTrust: this.subscribeIdeWorkspaceTrust,
      isAgentClientPresent: this.isAgentClientPresent,
      ...this.#registry,
      ...this.#sessionCommands,
      session: agent.session,
      readRawBrowserCatalog: this.readRawBrowserCatalog,
      deleteRawBrowserTarget: this.deleteRawBrowserTarget,
      bindRawBrowserSession: this.bindRawBrowserSession,
      readHistory: this.readHistory,
      stream: this.stream,
      appendHistory: this.appendHistory,
      injectSteer: this.injectSteer,
      getProviderContextLimit: this.getProviderContextLimit,
      getContentPrefixIdentity: this.getContentPrefixIdentity,
      tools: agent.tools,
      mcp: agent.mcp,
      metrics: agent.metrics,
      tasks: agent.tasks,
      disposeInput: this.disposeInput,
      readApprovalMode: this.readApprovalMode,
      setApprovalMode: this.setApprovalMode,
      generatePromptContent: this.generateText(),
      readPolicyRules: this.readPolicyRules,
      subagentDefinitions: agent.workspace.subagentDefinitions,
      subagentWrites: agent.workspace.subagentWrites,
      profileDefinitions: agent.workspace.profileDefinitions,
      triggerSessionStart: this.#sessionCommands.startCommandSession,
      recordRecordingEvent: this.#sessionCommands.recordCommandEvent,
      subscribeHistoryTokens: this.subscribeHistoryTokens,
      connectRecordingHistory: this.connectRecordingHistory,
      readProviderMetrics: this.readProviderMetrics,
      readSessionTokenUsage: this.readSessionTokenUsage,
      historyReads: this.#history,
      registerCredentials,
      readAgentRecordingPath: this.readAgentRecordingPath(),
      generateSubagentPrompt: this.generateSubagentPrompt(),
    };
  }

  createAppProps(): AppProps {
    return this.buildContainerProps(this.#registration);
  }
}
