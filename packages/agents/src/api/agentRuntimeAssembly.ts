import { resolveShellJobSettings } from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import type { SettingsStateSnapshot } from '@vybestack/llxprt-code-settings';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
import { runCleanupSteps } from '../core/subagent-cleanup.js';
import type { SchedulerConstruction } from '../session/assembleSchedulerOwner.js';
import { withChildToolDisplay } from '../session/childToolAssembly.js';
import { ChildToolDisplay } from '../session/childToolDisplay.js';
import { ShellJobOwner } from '../session/shell-job-owner.js';
import type { TaskLaunchOwner } from '../session/task-launch-owner.js';
import {
  assembleTaskOwner,
  cleanupFailedShellBootstrap,
} from './agent-shell-assembly.js';
import {
  buildFacadeState,
  createStableDisplayCallbacks,
  recordOwnership,
  wrapApprovalHandler,
  type StableDisplayCallbacksHolder,
  type StableEditorCallbacksHolder,
} from './agentBootstrap.js';
import { ForegroundAgentAssembly } from './foreground-agent-assembly.js';

import type { AgentAuth } from './config-types.js';
import { createAgentAuthState } from './control/authState.js';
import {
  assembleSessionAuthentication,
  clearProviderAuthenticationCache,
} from './control/session-authentication.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TokenStore } from '@vybestack/llxprt-code-auth';
import type { ProviderManager } from '@vybestack/llxprt-code-providers';
import { SettingsService } from '@vybestack/llxprt-code-settings';

import type { ParsedAgentConfig } from './config-schema.js';
import type { AgentConfig } from './config-types.js';
import {
  acquirePreferredFiles,
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
  acquirePreferredSettings,
  preparePreferredProviderCompletion,
} from './preferred-provider-acquisition.js';
import type { AgentRetainedProviderFile } from './provider-file-domain.js';

import type { MessageBus } from '@vybestack/llxprt-code-core';

import type { SessionClientOwner } from '../session/session-client-owner.js';

/**
 * @plan:ISSUE-3222
 * @requirement:REQ-3222-AC2
 *
 * Agent-owned runtime assembly. The public Agent API (createAgent/fromConfig)
 * builds complete shipped runtimes itself: the agent client and task-tool registration factories, the runtime
 * managers, and the isolated-runtime Config for subagent runtimes. Defaults
 * are installed per-field ONLY where the Config reports absence — caller
 * supplied factories and managers always win. Nothing here registers into
 * module-global state.
 */

import type {
  ContentGenerator,
  RuntimeContentGeneratorFactory,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type {
  CredentialAuthority,
  OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import { HostCredentialOwner } from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import {
  agentMcpAssemblyOptions,
  parseAgentConstruction,
} from './agent-construction-input.js';
import type { Agent } from './agent.js';
import type { resolveAuthType } from './agentBootstrap.js';
import type { AgentSchedulerHandle, EditorCallbacks } from './config-types.js';
import { injectConfirmationForcingPolicy } from './confirmationForcing.js';
import type { CreatedAgentMcpOptions } from './createAgent.js';
import {
  activateCreatedSession,
  cleanupFailedCreatedAgent,
  initializeCreatedClient,
  prepareAgentConfig,
  startAgentSession,
} from './createAgent.js';
import { resolveSchedulerFactory } from '../session/assembleSchedulerOwner.js';
import {
  assembleHostGitHubBroker,
  type HostGitHubBrokerOwner,
} from './host-github-broker-owner.js';
import { assembleWorkspaceFacade } from './agent-facade.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import {
  assembleOwnedMcpRuntime,
  bindCreatedSessionClient,
} from './policyComposition.js';
import { prepareImageConstruction } from './session-image-assembly.js';
import {
  prepareTransferredWorkspaceOwners,
  type TransferredWorkspaceOwners,
} from './transferred-workspace-owners.js';

export async function disposeIsolatedMediaRuntime(
  closeRuntime: () => void | Promise<void>,
  closeConfig: () => Promise<void>,
  closeMedia: () => Promise<void>,
  closeClient: (() => Promise<void>) | undefined,
): Promise<void> {
  const clients = await Promise.allSettled([closeClient?.()]);
  const results = await Promise.allSettled([closeRuntime(), closeConfig()]);
  const mediaResults = await Promise.allSettled([closeMedia()]);
  const failures = [...clients, ...results, ...mediaResults].flatMap(
    (result) => (result.status === 'rejected' ? [result.reason] : []),
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Isolated media runtime cleanup failed');
}

export class PreferredAgentAssembly extends ForegroundAgentAssembly {
  private preferredSettings!: SettingsService;

  private files!: ProviderFileLifecycle;
  private manager!: ProviderManager;
  private oauth!: OAuthManager;
  private tokenizerFactory!: RuntimeTokenizerFactory;
  private contentGeneratorFactory!: RuntimeContentGeneratorFactory<ContentGenerator>;
  private release!: AcquisitionRelease;
  private mcpRuntime!: McpRuntimeOwner;
  private preferredSessionClient: SessionClientOwner | undefined;
  private preferredMediaOwner!: SessionMediaOwner;
  private agent!: Agent;

  private parsed!: ParsedAgentConfig;
  private runtimeId!: string;
  private suppliedStore: TokenStore | undefined;
  private preferredMessageBus!: MessageBus;
  private tokenizerSelection: AgentConfig['tokenizerFactory'];
  private contentSelection: AgentConfig['contentGeneratorFactory'];
  private profileReads:
    | NonNullable<AgentConfig['definitionOwner']>['profileReads']
    | undefined;
  private authority!: CredentialAuthority;
  private mcpOptions!: CreatedAgentMcpOptions;
  private resolvedAuth!: ReturnType<typeof resolveAuthType>;

  private policyOwner!: RuntimePolicyOwner;
  private github: HostGitHubBrokerOwner | undefined;
  private onApproval: AgentConfig['onApproval'];
  private preferredOAuthPrompt: AgentConfig['onOAuthPrompt'];
  private editorCallbacks: EditorCallbacks | undefined;
  private readonly schedulerHandles: AgentSchedulerHandle[] = [];
  private schedulerFactory!: SchedulerConstruction;
  private executeShellCommand: AgentConfig['executeShellCommand'];
  private sessionOverrides: AgentConfig['sessionOverrides'];
  private oauthSettings: AgentConfig['oauthSettings'];
  private providerContributions: AgentConfig['providerContributions'];
  private trustPort: AgentConfig['trustPort'];
  private readonly inheritedTrustRelease = new AcquisitionRelease();
  private readonly workspaceRelease = new AcquisitionRelease();
  private transferred!: TransferredWorkspaceOwners;

  constructor(
    private readonly rawConfig: AgentConfig,
    private readonly retainedFiles: readonly AgentRetainedProviderFile[],
    private readonly settingsSnapshot: SettingsStateSnapshot | undefined,
  ) {
    super();
  }

  async assemble(): Promise<Agent> {
    // Everything the caller transferred is owned from here on, so host
    // credential acquisition sits inside the same rollback as the rest.
    const images = prepareImageConstruction(this.rawConfig.imageOperation);
    const owners = prepareTransferredWorkspaceOwners(this.rawConfig);
    this.transferred = owners;
    try {
      this.github = assembleHostGitHubBroker(this.rawConfig);
      const authority =
        this.rawConfig.credentialAuthority ??
        new HostCredentialOwner(process.env).authority;
      const input = {
        ...this.rawConfig,
        credentialAuthority: authority,
        imageOperation: images.selection,
      };
      await this.initializeWorkspace(input, authority);
      await this.acquireProviders();
      await this.finish();
      return this.agent;
    } catch (primary) {
      const failures: unknown[] = [];
      for (const cleanup of [
        () => this.github?.cleanupFailedConstruction(),
        () => images.cleanupFailedConstruction(),
        () => owners.cleanupFailedConstruction(),
      ]) {
        try {
          await cleanup();
        } catch (failure) {
          failures.push(failure);
        }
      }
      if (failures.length > 0)
        throw new AggregateError(
          [primary, ...failures],
          'createAgent GitHub cleanup failed',
        );
      throw primary;
    }
  }

  private async initializeWorkspace(
    raw: AgentConfig,
    authority: CredentialAuthority,
  ): Promise<void> {
    try {
      const construction = parseAgentConstruction(raw);
      this.parsed = construction.parsed;
      this.runtimeId = construction.runtimeId;
      this.resolvedAuth = construction.resolvedAuth;
      this.suppliedStore = construction.tokenStore;
      this.tokenizerSelection = raw.tokenizerFactory;
      this.contentSelection = raw.contentGeneratorFactory;
      this.profileReads = raw.definitionOwner?.profileReads;
      this.authority = authority;
      this.onApproval = construction.onApproval;
      this.preferredOAuthPrompt = construction.onOAuthPrompt;
      this.editorCallbacks = construction.editorCallbacks;
      this.executeShellCommand = raw.executeShellCommand;
      this.sessionOverrides = raw.sessionOverrides;
      this.oauthSettings = raw.oauthSettings;
      this.providerContributions = raw.providerContributions;
      this.constructWorkspace(raw, construction.suppliedMediaOwner);
      this.mcpOptions = agentMcpAssemblyOptions(
        raw,
        construction,
        this.trustPort,
      );
    } catch (primary) {
      await rejectPreferredAcquisition(
        primary,
        () => this.workspaceRelease.rollback(),
        async () => {},
      );
    }
  }

  private constructWorkspace(
    raw: AgentConfig,
    suppliedMedia: SessionMediaOwner | undefined,
  ): void {
    const { params, forceConfirmations } = prepareAgentConfig(
      this.parsed,
      this.runtimeId,
    );
    this.schedulerFactory = resolveSchedulerFactory(
      forceConfirmations,
      raw.toolSchedulerFactory,
      this.schedulerHandles,
    );
    const config = new Config({
      ...params,
      includeDirectories: [
        ...(params.includeDirectories ?? []),
        ...((this.parsed.harness?.includeProcessCwd ?? true)
          ? [process.cwd()]
          : []),
      ],
    });
    this.workspaceRelease.acquire('policy', () => config.dispose());
    this.config = config;
    this.trustPort = this.acquireWorkspaceTrust(raw);
    const policy = new RuntimePolicyOwner(config, this.trustPort);
    this.workspaceRelease.acquire('policy', () => policy.dispose());
    this.policyOwner = policy;
    if (forceConfirmations)
      injectConfirmationForcingPolicy(policy.session.confirmation);
    this.preferredMessageBus = policy.session.messageBus;
    const media =
      suppliedMedia ??
      new SessionMediaOwner(
        config.projectTempDir,
        config.getMediaStoreQuotaByteLimit(),
      );
    this.workspaceRelease.acquire('policy', () => media.dispose());
    this.preferredMediaOwner = media;
  }

  private acquireWorkspaceTrust(raw: AgentConfig): AgentConfig['trustPort'] {
    const parent = raw.parentTrustPort;
    if (parent === undefined) return raw.trustPort;
    const trust = new WorkspaceTrustLifecycle({
      localTrust: parent.isTrustedFolder(),
    });
    this.inheritedTrustRelease.acquire('policy', () => trust.dispose());
    this.workspaceRelease.acquire('policy', () =>
      this.inheritedTrustRelease.rollback(),
    );
    const stop = parent.subscribeTrustChange((transition) => {
      void trust.setTrustedFolderLive(transition.trusted);
    });
    this.inheritedTrustRelease.acquire('policy', stop);
    return trust;
  }

  private async releaseProviders(): Promise<void> {
    await runCleanupSteps([
      () => this.release.close(),
      () => this.inheritedTrustRelease.rollback(),
    ]);
  }

  private async acquireProviders(): Promise<void> {
    const release = new AcquisitionRelease();
    let settings: SettingsService;
    let settingsOwner: SessionSettingsOwner;
    let files: ProviderFileLifecycle;
    let manager: ProviderManager;
    let oauth: OAuthManager;
    let tokenizerFactory: RuntimeTokenizerFactory;
    try {
      settings =
        this.sessionOverrides === undefined
          ? new SettingsService()
          : SettingsService.withReadOnlySessionOverrides(this.sessionOverrides);
      if (this.settingsSnapshot !== undefined)
        settings.restoreFromStateSnapshot(this.settingsSnapshot);
      settingsOwner = acquirePreferredSettings(
        this.config,
        settings,
        this.parsed,
        release,
      );
      files = await acquirePreferredFiles(
        this.config,
        this.runtimeId,
        this.retainedFiles,
        release,
      );
      manager = acquirePreferredProviderManager(
        this.config,
        settings,
        settingsOwner,
        files,
        this.runtimeId,
        this.authority,
        release,
      );
      tokenizerFactory = configureProviderTokenizer(
        manager,
        this.tokenizerSelection,
      );
      this.contentGeneratorFactory =
        this.contentSelection ?? createRuntimeContentGeneratorFactory();
      oauth = acquirePreferredOAuth(
        this.suppliedStore,
        this.preferredMessageBus,
        this.config,
        settings,
        manager,
        this.runtimeId,
        this.profileReads,
        this.authority,
        release,
        this.oauthSettings,
      );
      await preparePreferredProviderCompletion(
        this.config,
        settings,
        settingsOwner,
        manager,
        oauth,
        this.runtimeId,
        tokenizerFactory,
        this.providerContributions,
      );
      this.preferredSettings = settings;
      this.settingsOwner = settingsOwner;
      this.files = files;
      this.manager = manager;
      this.oauth = oauth;
      this.tokenizerFactory = tokenizerFactory;
      this.release = release;
    } catch (primary) {
      await rejectPreferredAcquisition(
        primary,
        () => release.close(),
        () => this.workspaceRelease.rollback(),
      );
    }
  }

  private async finish(): Promise<void> {
    let disposeMcpRuntime = async (): Promise<void> =>
      this.policyOwner.dispose();
    try {
      const mcpRuntime = await assembleOwnedMcpRuntime(
        this.config,
        {
          ...this.mcpOptions,
          onTransferAccepted: () => this.transferred.handOffToMcp(),
        },
        this.policyOwner,
        this.settingsOwner,
      );
      disposeMcpRuntime = () => mcpRuntime.dispose();
      this.mcpRuntime = mcpRuntime;
      this.preferredSessionClient = await bindCreatedSessionClient(
        this.config,
        this.preferredSettings,
        this.settingsOwner,
        this.manager,
        this.oauth,
        this.contentGeneratorFactory,
        this.tokenizerFactory,
        this.files,
        this.preferredMediaOwner,
        mcpRuntime,
        (this.parsed.harness?.forceConfirmations ?? true) &&
          this.config.isInteractive(),
        this.mcpOptions.imageOperation,
        this.authority,
      );
      if (this.executeShellCommand !== undefined)
        this.preferredSessionClient.toolCatalog.bindShellExecution(
          this.executeShellCommand,
        );
      await this.initializeCreatedAgent();
    } catch (primaryError) {
      await cleanupFailedCreatedAgent(
        primaryError,
        () => this.releaseProviders(),
        this.config,
        this.preferredMediaOwner,
        this.preferredSessionClient,
        disposeMcpRuntime,
      );
    }
  }

  private async initializeCreatedAgent(): Promise<void> {
    const {
      preferredSettings: settings,
      settingsOwner,
      manager,
      oauth,
      mcpRuntime,
    } = this;
    const ownedSessionClient = this.preferredSessionClient;
    if (ownedSessionClient === undefined)
      throw new Error('Preferred Agent client was not acquired');
    await initializeCreatedClient(ownedSessionClient, this.github);
    const activationOutcome = await activateCreatedSession(
      this.parsed,
      this.resolvedAuth,
      this.config,
      settings,
      settingsOwner,
      manager,
      oauth,
      (): RuntimeKind => 'agent',
      this.policyOwner.session.messageBus,
      mcpRuntime,
      ownedSessionClient,
    );
    const agent = await this.#acquireFacade(
      { ...this.parsed, ...activationOutcome },
      this.resolvedAuth.baseUrl,
      this.schedulerHandles,
      this.schedulerFactory,
    );
    this.agent = await startAgentSession(agent);
  }

  async #acquireFacade(
    parsed: Parameters<typeof buildFacadeState>[0] & {
      readonly auth?: AgentAuth;
    },
    baseUrl: string | undefined,
    handles: AgentSchedulerHandle[],
    scheduler: SchedulerConstruction | undefined,
  ): Promise<Agent> {
    if (this.preferredSessionClient === undefined)
      throw new Error('Preferred Agent client was not acquired');
    const tasks = assembleTaskOwner(this.preferredSettings, undefined);
    const shell = new ShellJobOwner(() =>
      resolveShellJobSettings(this.preferredSettings),
    );
    const child = new ChildToolDisplay();
    const display: StableDisplayCallbacksHolder = {};
    try {
      const editors = { editorCallbacks: this.editorCallbacks ?? {} };
      this.preferredSessionClient.toolCatalog.bindChildExecution(
        child,
        tasks,
        shell,
      );
      this.preferredSessionClient.initializeExecution(
        withChildToolDisplay(
          scheduler ?? ((options) => new CoreToolScheduler(options)),
          child,
          tasks,
          shell,
        ),
        this.onApproval ? wrapApprovalHandler(this.onApproval) : undefined,
        createStableDisplayCallbacks(editors, display),
      );
      return this.#constructFacade(
        parsed,
        baseUrl,
        handles,
        tasks,
        shell,
        child,
        editors,
        display,
      );
    } catch (primary) {
      return cleanupFailedShellBootstrap(primary, tasks, shell);
    }
  }
  #authentication(): Agent['authentication'] {
    return assembleSessionAuthentication(this.oauth, (provider) =>
      clearProviderAuthenticationCache(
        this.manager.getProviderByName(provider),
      ),
    );
  }
  #constructFacade(
    parsed: Parameters<typeof buildFacadeState>[0] & {
      readonly auth?: AgentAuth;
    },
    baseUrl: string | undefined,
    handles: AgentSchedulerHandle[],
    tasks: TaskLaunchOwner,
    shell: ShellJobOwner,
    child: ChildToolDisplay,
    editors: StableEditorCallbacksHolder,
    display: StableDisplayCallbacksHolder,
  ): Agent {
    if (this.preferredSessionClient === undefined)
      throw new Error('Preferred Agent client was not acquired');
    const runtimeState = buildFacadeState(parsed, baseUrl, this.runtimeId);
    const ownership = recordOwnership({
      runtimeHandle: { cleanup: () => this.releaseProviders() },
      injectedSchedulerHandles: handles,
      configOwnership: 'agent',
      disposeMcpRuntime: () => this.mcpRuntime.dispose(),
    });
    this.preferredSessionClient.initializeConversation();
    const auth = createAgentAuthState();
    this.facadeSettingsOwner = this.settingsOwner;
    this.facadeSessionOwner = this.preferredSessionClient;
    this.facadeWorkspaceSkills = this.mcpRuntime.workspaceSkills.operations;
    this.facadeMediaOwner = this.preferredMediaOwner;
    this.facadeTaskOwner = tasks;
    this.facadeShellOwner = shell;
    const controls = assembleWorkspaceFacade(
      this.mcpRuntime,
      this.config,
      this.preferredSessionClient,
      auth,
      editors,
    );
    this.workspace = controls.workspace;
    this.ide = controls.ide;
    this.lsp = controls.lsp;
    this.awaitMcpDiscovery = (...args) =>
      this.mcpRuntime.awaitDiscovery(...args);
    this.closeMcpAdmission = (...args) =>
      this.mcpRuntime.closeAdmission(...args);
    this.mcp = controls.mcp;
    this.facadeAuthState = auth;
    this.facadeProviderManager = this.manager;
    this.facadeOAuth = this.oauth;
    this.facadeRuntimeKind = () => 'agent';
    this.facadeSettingsService = this.preferredSettings;
    this.facadeRuntimeId = this.runtimeId;
    this.closeRuntime = () => this.releaseProviders();

    this.facadeRuntimeState = runtimeState;
    this.facadeOwnership = ownership;
    this.sessionIdentityOwnership = 'config';

    this.facadeEditors = editors;
    this.facadeDisplay = display;
    this.onOAuthPrompt = this.preferredOAuthPrompt;
    this.initialAuth = parsed.auth;
    this.childDisplay = child;
    this.authentication = this.#authentication();
    return this.initializeFacade();
  }
}

async function rejectPreferredAcquisition(
  primary: unknown,
  closeProviderResources: () => Promise<void>,
  closeSessionResources: () => Promise<void>,
): Promise<never> {
  const results = await Promise.allSettled([
    closeProviderResources(),
    Promise.resolve().then(closeSessionResources),
  ]);
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(
      [primary, ...failures],
      'Preferred Agent acquisition cleanup failed',
    );
  throw primary;
}
