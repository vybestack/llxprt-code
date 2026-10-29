import { appendJournalUiItem } from '../ui/hooks/command-journal-output.js';
import type { InteractiveApplicationInputs } from './interactiveApplicationInputs.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createIdeCommand } from '../ui/commands/ideCommand.js';
import { bindIdeCommand } from '../ui/commands/ideCommandHost.js';
import { generateAutoPrompt } from '../ui/utils/autoPromptGenerator.js';
import { createWorkspaceCommandOwners } from '../ui/hooks/workspaceCommandOwners.js';
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

import { getProjectHash } from '@vybestack/llxprt-code-core';

import { type AppContainerProps } from '../ui/AppContainer.js';
import { bindPolicyRulesReader } from '../ui/hooks/policyRulesReaderHost.js';
import {
  createCliModelIdentityRuntime,
  resolveContentPrefixIdentity,
} from '../ui/utils/modelIdentity.js';

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
    (publish) => this.props.session.subscribeHistoryTokens(publish);
  private readonly connectRecordingHistory: AppContainerProps['connectRecordingHistory'] =
    (recording) =>
      this.props.session.connectRecordingHistory(() => recording.current);
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
      bindRawBrowserSession(config, this.props.resumeHistory, swaps, logger);
  readonly #registry: AppCommandRegistry;
  readonly #sessionCommands: ReturnType<
    InteractiveApplication['registerSessionCommands']
  >;
  readonly #history: RegisteredHistoryReads;
  readonly #registration: CredentialCommandRegistration;
  readonly #toolkeys = createToolkeyCommands();

  private readonly readAgentRecordingPath = (): string | undefined =>
    this.props.session.getRecording().path;

  private readonly appendHistory: AppContainerProps['appendHistory'] = (
    ...args
  ) => this.props.addHistory(...args);
  private readonly readHistory: AppContainerProps['readHistory'] = (...args) =>
    this.props.streamHistory(...args);
  private readonly stream: AppContainerProps['stream'] = (...args) =>
    this.props.stream(...args);
  private readonly injectSteer: AppContainerProps['injectSteer'] = (...args) =>
    this.props.injectSteer(...args);
  private readonly getProviderContextLimit: AppContainerProps['getProviderContextLimit'] =
    (...args) => this.props.getProviderContextLimit(...args);
  private readonly disposeInput: AppContainerProps['disposeInput'] = () =>
    this.props.dispose();
  private readonly readApprovalMode: AppContainerProps['readApprovalMode'] =
    () => this.props.getApprovalMode();
  private readonly setApprovalMode: AppContainerProps['setApprovalMode'] = (
    ...args
  ) => this.props.setApprovalMode(...args);
  private readonly readProviderMetrics: AppContainerProps['readProviderMetrics'] =
    () => this.props.providerReads.getActiveProviderMetrics();
  private readonly readSessionTokenUsage: AppContainerProps['readSessionTokenUsage'] =
    () => this.props.providerReads.getSessionTokenUsage();
  private readonly readPolicyRules: AppContainerProps['readPolicyRules'] = () =>
    bindPolicyRulesReader(this.props.policy, () =>
      this.props.approval.getApprovalMode(),
    )();
  private readonly getContentPrefixIdentity: AppContainerProps['getContentPrefixIdentity'] =
    () => {
      try {
        return resolveContentPrefixIdentity(
          createCliModelIdentityRuntime(this.props),
        );
      } catch {
        return null;
      }
    };

  private readonly generateSubagentPrompt: AppContainerProps['generateSubagentPrompt'] =
    (description) => generateAutoPrompt(description, this.props.generate);

  private registerRegistry() {
    return createAppCommandRegistry(
      this.props.commandRegistry,
      this.props.fileCommands,
      this.props.ide,
      this.props.mcp,
    );
  }

  private registerSessionCommands() {
    const a = this.props;
    const session = a.session;
    const resumeOwnedCommand: ResumeOwnedCommand = (action) =>
      action.sessionPackage === undefined
        ? resumeOwnerSession(
            session.resume.bind(session),
            action.sessionRef,
            session.listBrowserTargetsDetailed.bind(session),
          )
        : importOwnerSession(
            session.importSession.bind(session),
            action.sessionPackage.packageDirectory,
          );
    return {
      registerWorkspaceCommands: this.registerWorkspaceCommands(),
      registerChatCommands: this.registerChatCommands(),
      registerSubagentCommand: this.registerSubagentCommand(),
      resumeOwnedCommand,
      bindRawCommandResume: ((config, callbacks) =>
        bindCommandRawResume(
          config,
          config?.sessionPersistence,
          a.resumeHistory,
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
    this.props.ide.getIdeMode();
  private readonly readCurrentIde: AppContainerProps['readCurrentIde'] = () =>
    this.props.ide.readConnection().currentIde;
  private readonly readIdeContext: AppContainerProps['readIdeContext'] = () =>
    this.props.ide.readContext();
  private readonly subscribeIdeContext: AppContainerProps['subscribeIdeContext'] =
    (listener) => this.props.ide.subscribeContext(listener);
  private readonly readIdeWorkspaceTrust: AppContainerProps['readIdeWorkspaceTrust'] =
    () => this.props.ide.readWorkspaceTrust();
  private readonly subscribeIdeWorkspaceTrust: AppContainerProps['subscribeIdeWorkspaceTrust'] =
    (listener) => this.props.ide.subscribeWorkspaceTrust(listener);
  private readonly readIdeDisplayName: AppContainerProps['readIdeDisplayName'] =
    () =>
      this.props.ide.getIdeMode()
        ? (this.props.ide.readConnection().detectedIdeDisplayName ?? '')
        : '';
  private readonly readIdeAvailable: AppContainerProps['readIdeAvailable'] =
    () => this.props.ide.readConnection().available;
  private readonly readIdeDiffingEnabled: AppContainerProps['readIdeDiffingEnabled'] =
    () => {
      const connection = this.props.ide.readConnection();
      return connection.available ? connection.diffingEnabled : null;
    };
  private readonly subscribeIdeDiffing: AppContainerProps['subscribeIdeDiffing'] =
    (listener) => this.props.ide.subscribeConnection(() => listener());
  private readonly resolveIdeDiff: AppContainerProps['resolveIdeDiff'] = (
    ...args
  ) => this.props.ide.resolveDiff(...args);
  private readonly registerIdeCommand: AppContainerProps['registerIdeCommand'] =
    (addItem) => {
      const ide = this.props.ide;
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
    const a = this.props;
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
    const a = this.props;
    const c = this.props.chatCommands;
    const s = a.session;
    const owner = bindChatOwnerOperations(
      s.listCheckpoints.bind(s),
      s.createCheckpoint.bind(s),
      s.resume.bind(s),
      s.deleteCheckpoint.bind(s),
      s.renameCheckpoint.bind(s),
      () => s.getJournalLength(),
      s.clearHistory.bind(s),
      s.restoreTurns.bind(s),
      s.nameCurrentSession.bind(s),
      () => s.getRecording().path,
      () => a.getModel(),
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
                s.clearHistory.bind(s),
                s.restoreTurns.bind(s),
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
    const a = this.props;
    const generate = this.props.generate;
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
    const a = this.props;
    return {
      writeOutput: async (item) => {
        await appendJournalUiItem(a.readJournal(), undefined, item);
      },
      compressHistory: (...args) => a.compress(...args),
      readRawHistory: () => a.session.readInitializedHistory(),
      isHistoryInitialized: a.session.isHistoryInitialized.bind(a.session),
      readHistory: () => a.streamHistory(),
      replaceHistoryFromSource: a.replaceHistoryFromSource,
      readDumpHistory: a.openDumpSnapshot,
    };
  }
  private models() {
    const a = this.props;
    return createModelRegistration(
      this.props.setActiveModel,
      this.props.getActiveToolFormatState,
      this.props.setActiveToolFormatOverride,
      this.props.getActiveProviderName,
      this.props.getActiveModelName,
      this.props.getActiveProviderAliasConfig,
      (name, options) => a.setProvider(name, undefined, options),
      this.props.providerAliasRefresh,
    );
  }
  private profiles() {
    const a = this.props;
    const { oauthControl: oauth, settings } = this.props;
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
    const a = this.props;
    const { settings } = this.props;
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
        async (item) => {
          await appendJournalUiItem(a.readJournal(), undefined, item);
        },
        reload,
      );
  }
  private register(): CredentialCommandRegistration {
    const { keyCommands: c, oauthControl: oauth, settings } = this.props;
    const a = this.props;
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
    | 'resumedBoot'
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
      resumedBoot: props.resumedBoot,
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
    const agent = this.props;
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
      generatePromptContent: this.props.generate,
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
      readJournal: this.props.readJournal,
      subscribeContextRange: this.props.subscribeContextRange,
      registerCredentials,
      readAgentRecordingPath: this.readAgentRecordingPath,
      generateSubagentPrompt: this.generateSubagentPrompt,
    };
  }

  createAppProps(): AppProps {
    return this.buildContainerProps(this.#registration);
  }
}
