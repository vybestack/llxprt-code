import type { SettingsStateSnapshot } from '@vybestack/llxprt-code-settings';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { runCleanupSteps } from '../core/subagent-cleanup.js';
import {
  ChildAgentAssembly,
  type ChildAgentLaunch,
} from './child-agent-assembly.js';
import type {
  ProfileDefinitionReads,
  SubagentDefinitionReads,
  WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';
import type { InteractiveAuthPromptOperation } from '@vybestack/llxprt-code-core/runtime/contracts/InteractiveAuthPrompt.js';
import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { SubAgentScope } from '../core/subagent.js';
import type { SubagentLaunchResult } from '../core/subagentOrchestrator.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { TokenStore } from '@vybestack/llxprt-code-auth';
import type { ProviderManager } from '@vybestack/llxprt-code-providers';

import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  acquirePreferredSettings,
  acquirePreferredFiles,
  preparePreferredProviderCompletion,
} from './preferred-provider-acquisition.js';
import type { ParsedAgentConfig } from './config-schema.js';
import type { AgentConfig } from './config-types.js';
import type { AgentRetainedProviderFile } from './provider-file-domain.js';

import {
  assembleSessionImages,
  type SessionImageSelection,
} from './session-image-assembly.js';
import type { MessageBus } from '@vybestack/llxprt-code-core';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';

import { SessionClientOwner } from '../session/session-client-owner.js';

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

import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { buildAgentClientFactory } from './agentBootstrap.js';
import type { resolveAuthType } from './agentBootstrap.js';
import type { AgentClientFactory } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { Agent } from './agent.js';
import {
  activateCreatedSession,
  cleanupFailedCreatedAgent,
  finalizeAgent,
  initializeCreatedClient,
  prepareAgentConfig,
  resolveSchedulerFactory,
  startAgentSession,
} from './createAgent.js';
import type { CreatedAgentMcpOptions } from './createAgent.js';
import { createTaskRegistration } from './runtimeFactories.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import {
  assembleOwnedMcpRuntime,
  bindCreatedSessionClient,
} from './policyComposition.js';
import type {
  AgentRuntimeFactoryBindings,
  RuntimeProviderManager,
  RuntimeContentGeneratorFactory,
  RuntimeTokenizerFactory,
  ContentGenerator,
} from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { EditorCallbacks, AgentSchedulerHandle } from './config-types.js';
import type { SchedulerConstruction } from '../session/assembleSchedulerOwner.js';
import type {
  OAuthManager,
  CredentialAuthority,
} from '@vybestack/llxprt-code-providers/auth.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { releaseAdoptedFileScope } from './adoption-release.js';
import {
  acquireAdoptedProviderManager,
  acquireAdoptedOAuth,
  activateAdoptedProviders,
} from './adopted-provider-assembly.js';
import { completeAdoptedAgent } from './adopted-agent-completion.js';
import { cleanupFailedAdoption } from './fromConfig-cleanup.js';
import { adoptedDefinitionCleanup } from './adopted-definition-assembly.js';
import type { FromConfigOptions } from './config-types.js';
import {
  assembleHostGitHubBroker,
  type HostGitHubBrokerOwner,
} from './host-github-broker-owner.js';
import { HostCredentialOwner } from '@vybestack/llxprt-code-providers/auth.js';
import { prepareImageConstruction } from './session-image-assembly.js';
import {
  parseAgentConstruction,
  agentMcpAssemblyOptions,
} from './agent-construction-input.js';
import { injectConfirmationForcingPolicy } from './confirmationForcing.js';

/**
 * Extra teardown context for {@link cleanupFailedRuntimeBootstrap} beyond the
 * isolated runtime handle.
 */
export interface FailedBootstrapTeardown {
  /**
   * The fully built Agent facade, when the failure happened AFTER finalize
   * (e.g. session-start). Its idempotent dispose() is the complete teardown —
   * isolated handle, agent-owned Config, hooks — and replaces piecemeal
   * cleanup.
   */
  readonly facade?: Agent;
  /**
   * The agent-owned Config to dispose when no facade exists yet. Disposed
   * AFTER the isolated handle (children before parents): initialize() started
   * MCP discovery, the extension loader, LSP and the AgentClient on it, and
   * only Config.dispose() releases those — except the LSP service, which
   * Config.dispose() does NOT stop and which cleanupFailedRuntimeBootstrap
   * shuts down explicitly after the dispose. Caller-owned Configs (fromConfig
   * adopts one) are never passed here.
   */
  readonly ownedConfig?: Config;
}

/**
 * Cleans up a failed agent bootstrap and surfaces the ORIGINAL error. When
 * cleanup also fails, every error surfaces through an AggregateError so
 * neither is swallowed.
 */
export async function cleanupFailedRuntimeBootstrap(
  closeRuntime: () => void | Promise<void>,
  primaryError: unknown,
  source: string,
  teardown: FailedBootstrapTeardown = {},
): Promise<never> {
  const cleanupErrors: unknown[] = [];
  if (teardown.facade !== undefined) {
    try {
      await teardown.facade.dispose();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  } else {
    try {
      await closeRuntime();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (teardown.ownedConfig !== undefined) {
      try {
        await teardown.ownedConfig.dispose();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      `${source} bootstrap failed and isolated runtime cleanup also failed`,
    );
  }
  throw primaryError;
}

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

export async function createIsolatedSessionClient(
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  providerManager: RuntimeProviderManager,
  oauthManager: OAuthManager,
  contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>,
  tokenizerFactory: RuntimeTokenizerFactory,
  providerFileLifecycle: ProviderFileLifecycle,
  mediaOwner: SessionMediaOwner,
  factory: AgentClientFactory = buildAgentClientFactory(),
  readInstructions: () => string | undefined,
  workspacePaths: WorkspacePathOperations,
  messageBus?: MessageBus,
  imageOperation?: SessionImageSelection['imageOperation'],
): Promise<SessionClientOwner> {
  const client = await SessionClientOwner.create(
    config,
    assembleTaskSchemaPolicy(settings),
    providerManager,
    factory,
    mediaOwner.store,
    readInstructions,
    workspacePaths,
    settingsOwner,
    contentGeneratorFactory,
    tokenizerFactory,
    undefined,
    messageBus,
  );
  client.bindInteractiveAuthRequests((prompt) =>
    oauthManager.requestInteractiveAuth(prompt),
  );
  assembleSessionImages(
    client,
    config.getTargetDir(),
    providerManager,
    oauthManager,
    settings,
    imageOperation,
  );
  const mainScope = config.getSessionId();
  client.bindProviderFiles(
    providerFileLifecycle,
    (provider) => oauthManager.composeRetryOperations(provider),
    (scope) =>
      scope === mainScope
        ? Promise.resolve()
        : SessionClientOwner.cleanupProviderScope(providerFileLifecycle, scope),
  );
  return client;
}

export function closeIsolatedSessionRuntime(
  closeRuntime: () => void | Promise<void>,
  closeConfig: () => Promise<void>,
  closeMedia: () => Promise<void>,
  closeClient: () => Promise<void>,
): Promise<void> {
  return disposeIsolatedMediaRuntime(
    closeRuntime,
    closeConfig,
    closeMedia,
    closeClient,
  );
}

export function assembleAdoptedAgent(
  options: FromConfigOptions,
  github: HostGitHubBrokerOwner | undefined,
  runtimeId: string,
  mcp: McpRuntimeOwner,
  media: SessionMediaOwner | undefined,
): Promise<Agent> {
  const release = new AcquisitionRelease();
  const preflight = options.activationPreflight?.operation;
  try {
    const authority = options.credentialAuthority;
    if (authority === undefined)
      throw new Error('Adoption requires captured credential authority');
    const transferred = preflight?.takeSettingsOwner(options.settingsService);
    const settingsOwner =
      transferred ??
      options.settingsOwner ??
      new SessionSettingsOwner(options.settingsService);
    if (
      (transferred !== undefined &&
        preflight?.settingsOwnerOwnership === 'transferred') ||
      (transferred === undefined && options.settingsOwner === undefined)
    )
      release.acquire('settings', () => settingsOwner.dispose());
    settingsOwner.bindTelemetry(options.config);
    const files =
      options.providerFileLifecycle ??
      preflight?.providerFileLifecycle ??
      new ProviderFileLifecycle({ maxFiles: 100, maxBytes: 512 * 1024 * 1024 });
    const clientScope = options.config.getSessionId();
    for (const scope of runtimeId === clientScope
      ? [clientScope]
      : [runtimeId, clientScope])
      release.acquire('files', () => releaseAdoptedFileScope(files, scope));
    const manager = acquireAdoptedProviderManager(
      options.providerManager,
      options.config,
      options.settingsService,
      settingsOwner,
      files,
      runtimeId,
      authority,
      release,
    );
    return finishAdoptionAssembly(
      options,
      github,
      runtimeId,
      mcp,
      media,
      settingsOwner,
      files,
      manager,
      release,
      authority,
    );
  } catch (primary) {
    return cleanupFailedAdoption(
      primary,
      () => release.rollback(),
      adoptedDefinitionCleanup(
        mcp,
        options.definitionOwner,
        options.definitionOwnership,
        (options.mcpOwnership ??
          (options.mcpRuntime === undefined ? 'agent' : 'caller')) === 'agent',
      ),
      media === undefined ? undefined : () => media.dispose(),
      undefined,
    );
  }
}

function finishAdoptionAssembly(
  options: FromConfigOptions,
  github: HostGitHubBrokerOwner | undefined,
  runtimeId: string,
  mcp: McpRuntimeOwner,
  media: SessionMediaOwner | undefined,
  settingsOwner: SessionSettingsOwner,
  files: ProviderFileLifecycle,
  manager: RuntimeProviderManager,
  release: AcquisitionRelease,
  authority: CredentialAuthority,
): Promise<Agent> {
  const preflight = options.activationPreflight?.operation;
  const tokenizerFactory = configureProviderTokenizer(
    manager,
    options.tokenizerFactory ?? preflight?.tokenizerFactory,
  );
  const contentGeneratorFactory =
    options.contentGeneratorFactory ??
    preflight?.contentGeneratorFactory ??
    createRuntimeContentGeneratorFactory();
  const oauth = acquireAdoptedOAuth(
    options.oauthManager ?? preflight?.oauthManager,
    options.tokenStore,
    mcp.messageBus,
    options.config,
    options.settingsService,
    manager,
    runtimeId,
    options.definitionOwner?.profileReads ??
      preflight?.workspaceDefinitions.profileReads ??
      options.mcpRuntime?.profileDefinitions,
    authority,
    release,
  );
  return completeAdoptedAgent(
    options,
    github,
    runtimeId,
    mcp,
    media,
    settingsOwner,
    manager,
    oauth,
    files,
    tokenizerFactory,
    contentGeneratorFactory,
    () =>
      activateAdoptedProviders(
        options.config,
        options.settingsService,
        settingsOwner,
        manager,
        oauth,
        runtimeId,
        options.providerManager === undefined,
        tokenizerFactory,
      ),
    () => release.close(),
    options.policyOwner === undefined && options.mcpRuntime !== undefined
      ? undefined
      : options.messageBus,
    (options.mcpOwnership ??
      (options.mcpRuntime === undefined ? 'agent' : 'caller')) === 'agent',
  );
}

export class PreferredAgentAssembly {
  private settings!: SettingsService;
  private settingsOwner!: SessionSettingsOwner;
  private files!: ProviderFileLifecycle;
  private manager!: ProviderManager;
  private oauth!: OAuthManager;
  private tokenizerFactory!: RuntimeTokenizerFactory;
  private contentGeneratorFactory!: RuntimeContentGeneratorFactory<ContentGenerator>;
  private release!: AcquisitionRelease;
  private mcpRuntime!: McpRuntimeOwner;
  private sessionClient: SessionClientOwner | undefined;
  private agent!: Agent;

  private config!: Config;
  private parsed!: ParsedAgentConfig;
  private runtimeId!: string;
  private suppliedStore: TokenStore | undefined;
  private messageBus!: MessageBus;
  private tokenizerSelection: AgentConfig['tokenizerFactory'];
  private contentSelection: AgentConfig['contentGeneratorFactory'];
  private profileReads:
    | NonNullable<AgentConfig['definitionOwner']>['profileReads']
    | undefined;
  private authority!: CredentialAuthority;
  private mcpOptions!: CreatedAgentMcpOptions;
  private resolvedAuth!: ReturnType<typeof resolveAuthType>;
  private mediaOwner!: SessionMediaOwner;
  private agentClientFactory: AgentClientFactory | undefined;
  private taskToolRegistration:
    | AgentRuntimeFactoryBindings['taskToolRegistration']
    | undefined;
  private policyOwner!: RuntimePolicyOwner;
  private github: HostGitHubBrokerOwner | undefined;
  private onApproval: AgentConfig['onApproval'];
  private onOAuthPrompt: AgentConfig['onOAuthPrompt'];
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

  constructor(
    private readonly rawConfig: AgentConfig,
    private readonly retainedFiles: readonly AgentRetainedProviderFile[],
    private readonly settingsSnapshot: SettingsStateSnapshot | undefined,
  ) {}

  async assemble(): Promise<Agent> {
    const authority =
      this.rawConfig.credentialAuthority ??
      new HostCredentialOwner(process.env).authority;
    const images = prepareImageConstruction(this.rawConfig.imageOperation);
    this.github = assembleHostGitHubBroker(this.rawConfig);
    try {
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
      const results = await Promise.allSettled([
        this.github?.cleanupFailedConstruction(),
        images.cleanupFailedConstruction(),
      ]);
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
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
      this.agentClientFactory =
        construction.runtimeFactoryBindings?.agentClientFactory;
      this.taskToolRegistration =
        construction.runtimeFactoryBindings?.taskToolRegistration;
      this.onApproval = construction.onApproval;
      this.onOAuthPrompt = construction.onOAuthPrompt;
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
    this.messageBus = policy.session.messageBus;
    const media =
      suppliedMedia ??
      new SessionMediaOwner(
        config.projectTempDir,
        config.getMediaStoreQuotaByteLimit(),
      );
    this.workspaceRelease.acquire('policy', () => media.dispose());
    this.mediaOwner = media;
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
        this.messageBus,
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
      this.settings = settings;
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
      const registration = createTaskRegistration(
        this.mcpOptions.credentialAuthority,
      );
      const mcpRuntime = await assembleOwnedMcpRuntime(
        this.config,
        this.policyOwner.session.messageBus,
        this.mcpOptions,
        this.policyOwner,
        this.settingsOwner,
      );
      disposeMcpRuntime = () => mcpRuntime.dispose();
      this.mcpRuntime = mcpRuntime;
      this.sessionClient = await bindCreatedSessionClient(
        this.config,
        this.settings,
        this.settingsOwner,
        this.manager,
        this.oauth,
        this.contentGeneratorFactory,
        this.tokenizerFactory,
        this.files,
        this.mediaOwner,
        this.agentClientFactory,
        mcpRuntime,
        this.taskToolRegistration?.(registration) ?? registration,
        (this.parsed.harness?.forceConfirmations ?? true) &&
          this.config.isInteractive(),
        this.mcpOptions.imageOperation,
      );
      if (this.executeShellCommand !== undefined)
        this.sessionClient.toolCatalog.bindShellExecution(
          this.executeShellCommand,
        );
      await this.initializeCreatedAgent();
    } catch (primaryError) {
      await cleanupFailedCreatedAgent(
        primaryError,
        () => this.releaseProviders(),
        this.config,
        this.mediaOwner,
        this.sessionClient,
        disposeMcpRuntime,
      );
    }
  }

  private async initializeCreatedAgent(): Promise<void> {
    const { settings, settingsOwner, manager, oauth, mcpRuntime } = this;
    const ownedSessionClient = this.sessionClient;
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
    const agent = await finalizeAgent(
      { ...this.parsed, ...activationOutcome },
      this.resolvedAuth,
      this.config,
      manager,
      oauth,
      settings,
      this.runtimeId,
      settingsOwner,
      (): RuntimeKind => 'agent',
      () => this.releaseProviders(),
      this.onApproval,
      this.onOAuthPrompt,
      this.editorCallbacks,
      this.schedulerHandles,
      'agent',
      () => mcpRuntime.dispose(),
      mcpRuntime,
      this.schedulerFactory,
      undefined,
      'config',
      this.mediaOwner,
      ownedSessionClient,
      mcpRuntime.workspaceSkills.operations,
    );
    this.agent = await startAgentSession(agent);
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

export function assembleChildAgent(
  data: ChildAgentLaunch,
  authority: CredentialAuthority,
  messageBus: MessageBus,
  requestInteractiveAuth: InteractiveAuthPromptOperation | undefined,
  profileReads: Pick<ProfileDefinitionReads, 'loadProfile'>,
  subagentReads: Pick<
    SubagentDefinitionReads,
    'loadSubagent' | 'listSubagents'
  >,
  telemetry: RootTelemetry | undefined,
  createChildSettings: () => SettingsService,
  foregroundConfig: Config,
  instructions: InstructionReadOperations,
  workspacePaths: WorkspacePathOperations,
  readMcpInstructions: () => string | undefined,
  trust: WorkspaceTrustControlPort | undefined,
  tools: ToolSelection | undefined,
  hooks: SessionHookOwner | undefined,
  clientFactory: AgentClientFactory | undefined,
  runtimeLoader: typeof loadAgentRuntime,
  scopeFactory: typeof SubAgentScope.create,
): Promise<SubagentLaunchResult> {
  return new ChildAgentAssembly(
    data,
    authority,
    messageBus,
    requestInteractiveAuth,
    profileReads,
    subagentReads,
    telemetry,
    createChildSettings,
    foregroundConfig,
    instructions,
    workspacePaths,
    readMcpInstructions,
    trust,
    tools,
    hooks,
    clientFactory,
    runtimeLoader,
    scopeFactory,
  ).assemble();
}
