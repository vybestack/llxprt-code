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

import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { buildAgentClientFactory } from './agentBootstrap.js';
import type { resolveAuthType } from './agentBootstrap.js';
import type { AgentClientFactory } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { Agent } from './agent.js';
import {
  activateCreatedSession,
  cleanupFailedCreatedAgent,
  finalizeAgent,
  initializeCreatedClient,
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
import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { EditorCallbacks, AgentSchedulerHandle } from './config-types.js';
import type { SchedulerConstruction } from '../session/assembleSchedulerOwner.js';
import type {
  OAuthManager,
  CredentialAuthority,
} from '@vybestack/llxprt-code-providers/auth.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
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
import type { HostGitHubBrokerOwner } from './host-github-broker-owner.js';

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
  const { tokenizerFactory, contentGeneratorFactory } =
    configureProviderRuntimeFactories(options.config, manager, {
      tokenizerFactory: options.tokenizerFactory ?? preflight?.tokenizerFactory,
      contentGeneratorFactory:
        options.contentGeneratorFactory ?? preflight?.contentGeneratorFactory,
    });
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

export function assemblePreferredAgent(
  config: Config,
  parsed: ParsedAgentConfig,
  runtimeId: string,
  suppliedStore: TokenStore | undefined,
  messageBus: MessageBus,
  tokenizerSelection: AgentConfig['tokenizerFactory'],
  contentSelection: AgentConfig['contentGeneratorFactory'],
  profileReads:
    | NonNullable<AgentConfig['definitionOwner']>['profileReads']
    | undefined,
  authority: CredentialAuthority,
  retainedFiles: readonly AgentRetainedProviderFile[],
  cleanupPartial: () => Promise<void>,
  mcpOptions: CreatedAgentMcpOptions,
  resolvedAuth: ReturnType<typeof resolveAuthType>,
  mediaOwner: SessionMediaOwner,
  agentClientFactory: AgentClientFactory | undefined,
  taskToolRegistration:
    | AgentRuntimeFactoryBindings['taskToolRegistration']
    | undefined,
  policyOwner: RuntimePolicyOwner,
  github: HostGitHubBrokerOwner | undefined,
  onApproval: AgentConfig['onApproval'],
  onOAuthPrompt: AgentConfig['onOAuthPrompt'],
  editorCallbacks: EditorCallbacks | undefined,
  schedulerHandles: AgentSchedulerHandle[],
  schedulerFactory: SchedulerConstruction,
  executeShellCommand: AgentConfig['executeShellCommand'],
): Promise<Agent> {
  return new PreferredAgentAssembly(
    config,
    parsed,
    runtimeId,
    suppliedStore,
    messageBus,
    tokenizerSelection,
    contentSelection,
    profileReads,
    authority,
    retainedFiles,
    cleanupPartial,
    mcpOptions,
    resolvedAuth,
    mediaOwner,
    agentClientFactory,
    taskToolRegistration,
    policyOwner,
    github,
    onApproval,
    onOAuthPrompt,
    editorCallbacks,
    schedulerHandles,
    schedulerFactory,
    executeShellCommand,
  ).assemble();
}

class PreferredAgentAssembly {
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

  constructor(
    private readonly config: Config,
    private readonly parsed: ParsedAgentConfig,
    private readonly runtimeId: string,
    private readonly suppliedStore: TokenStore | undefined,
    private readonly messageBus: MessageBus,
    private readonly tokenizerSelection: AgentConfig['tokenizerFactory'],
    private readonly contentSelection: AgentConfig['contentGeneratorFactory'],
    private readonly profileReads:
      | NonNullable<AgentConfig['definitionOwner']>['profileReads']
      | undefined,
    private readonly authority: CredentialAuthority,
    private readonly retainedFiles: readonly AgentRetainedProviderFile[],
    private readonly cleanupPartial: () => Promise<void>,
    private readonly mcpOptions: CreatedAgentMcpOptions,
    private readonly resolvedAuth: ReturnType<typeof resolveAuthType>,
    private readonly mediaOwner: SessionMediaOwner,
    private readonly agentClientFactory: AgentClientFactory | undefined,
    private readonly taskToolRegistration:
      | AgentRuntimeFactoryBindings['taskToolRegistration']
      | undefined,
    private readonly policyOwner: RuntimePolicyOwner,
    private readonly github: HostGitHubBrokerOwner | undefined,
    private readonly onApproval: AgentConfig['onApproval'],
    private readonly onOAuthPrompt: AgentConfig['onOAuthPrompt'],
    private readonly editorCallbacks: EditorCallbacks | undefined,
    private readonly schedulerHandles: AgentSchedulerHandle[],
    private readonly schedulerFactory: SchedulerConstruction,
    private readonly executeShellCommand: AgentConfig['executeShellCommand'],
  ) {}

  async assemble(): Promise<Agent> {
    const release = new AcquisitionRelease();
    let settings: SettingsService;
    let settingsOwner: SessionSettingsOwner;
    let files: ProviderFileLifecycle;
    let manager: ProviderManager;
    let oauth: OAuthManager;
    let tokenizerFactory: RuntimeTokenizerFactory;
    let contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>;
    try {
      settings = new SettingsService();
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
      ({ tokenizerFactory, contentGeneratorFactory } =
        configureProviderRuntimeFactories(this.config, manager, {
          tokenizerFactory: this.tokenizerSelection,
          contentGeneratorFactory: this.contentSelection,
        }));
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
      );
      await preparePreferredProviderCompletion(
        this.config,
        settings,
        settingsOwner,
        manager,
        oauth,
        this.runtimeId,
        tokenizerFactory,
      );
    } catch (primary) {
      return rejectPreferredAcquisition(
        primary,
        () => release.close(),
        this.cleanupPartial,
      );
    }
    this.settings = settings;
    this.settingsOwner = settingsOwner;
    this.files = files;
    this.manager = manager;
    this.oauth = oauth;
    this.tokenizerFactory = tokenizerFactory;
    this.contentGeneratorFactory = contentGeneratorFactory;
    this.release = release;
    await this.finish();
    return this.agent;
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
        () => this.release.close(),
        this.config,
        this.mediaOwner,
        this.sessionClient,
        disposeMcpRuntime,
      );
    }
  }

  private async initializeCreatedAgent(): Promise<void> {
    const { settings, settingsOwner, manager, oauth, release, mcpRuntime } =
      this;
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
      () => release.close(),
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
