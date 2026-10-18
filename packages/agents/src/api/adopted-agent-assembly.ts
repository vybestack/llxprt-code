import { DEFAULT_SKILL_OPERATIONS } from './workspace-skill-assembly.js';
import type { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import {
  assertAdoptedWorkspaceHandoff,
  assertAdoptedWorkspaceRoots,
  assertMcpHandoff,
  runtimeOwnership,
  selectedOwnership,
} from './mcpOAuthAssembly.js';
import { buildOwnedMcpControl } from './control/mcpControlWiring.js';
import {
  createAgentAuthState,
  type AgentAuthState,
} from './control/authState.js';
import type { McpControl } from './control/mcpControl.js';
import { WorkspaceControl } from './control/workspaceControl.js';
import { projectTrustedSubagents } from './workspace-definition-assembly.js';
import { assembleIdeControl } from './control/ideControl.js';
import { LspControl } from './control/lspControl.js';
import { resolveShellJobSettings } from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
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
  AgentBootstrapError,
  generateRuntimeId,
  validateAgentRuntimeId,
  buildFacadeState,
  createStableDisplayCallbacks,
  recordOwnership,
  wrapApprovalHandler,
  type StableDisplayCallbacksHolder,
  type StableEditorCallbacksHolder,
} from './agentBootstrap.js';
import {
  assembleSessionAuthentication,
  clearProviderAuthenticationCache,
} from './control/session-authentication.js';
import type { PrepareSessionTools } from './fromConfig.js';
import { assembleModelSelection } from './model-selection.js';
import { setActiveModel } from './providerMutations.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AgentRuntimeFactoryBindings,
  ContentGenerator,
  RuntimeContentGeneratorFactory,
  RuntimeProviderManager,
  RuntimeTokenizerFactory,
  TokenStore,
  WorkspaceDefinitionOwner,
  WorkspaceIdePort,
  WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';
import { Config, openBrowserSecurely } from '@vybestack/llxprt-code-core';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import type { WorkspaceLspOwner } from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import {
  KeychainTokenStorage,
  MCPOAuthTokenStorage,
  type TokenStorage,
} from '@vybestack/llxprt-code-mcp';
import type { McpHostServices } from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  HostCredentialOwner,
  type CredentialAuthority,
  type OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { GitHubBrokerClient } from '@vybestack/llxprt-code-tools';
import { admittedEndpoint } from '../core/admittedRouteSecurity.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import {
  AgentActivationBootstrap,
  type ActivationPreflight,
} from './activationPreflightState.js';
import { adoptedDefinitionCleanup } from './adopted-definition-assembly.js';
import {
  acquireAdoptedOAuth,
  acquireAdoptedProviderManager,
  activateAdoptedProviders,
} from './adopted-provider-assembly.js';
import { releaseAdoptedFileScope } from './adoption-release.js';
import type { Agent } from './agent.js';
import { AgentImpl } from './agentImpl.js';
import type {
  AgentAuth,
  AgentAdoptionIntent,
  AgentConfig,
  AgentSchedulerFactory,
  AgentSchedulerHandle,
  ApprovalHandler,
  EditorCallbacks,
  OAuthPromptHandler,
} from './config-types.js';
import { FromConfigValidatableSchema } from './config-types.js';
import { resolveSchedulerFactory } from './createAgent.js';
import {
  cleanupFailedAdoption,
  cleanupFailedFromConfig,
  closePreflightAfterAdoption,
} from './fromConfig-cleanup.js';
import {
  activateAdoptedSession,
  initializeAdoptedClient,
} from './fromConfig-session.js';
import {
  assembleHostGitHubBroker,
  type HostGitHubBrokerOwner,
} from './host-github-broker-owner.js';
import { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import { createTaskRegistration } from './runtimeFactories.js';
import {
  acquireAdoptedMedia,
  prepareImageConstruction,
  type SessionImageSelection,
} from './session-image-assembly.js';

export class AdoptedAgentAssembly {
  constructor(
    private readonly config: Config,
    private readonly settingsService: SettingsService,
    private readonly intent: AgentAdoptionIntent,
    private readonly settingsOwner: SessionSettingsOwner | undefined,
    private readonly providerManager: RuntimeProviderManager | undefined,
    private readonly oauthManager: OAuthManager | undefined,
    private readonly messageBus: MessageBus | undefined,
    private readonly mcpRuntime: McpRuntimeOwner | undefined,
    private readonly activationPreflight: ActivationPreflight | undefined,
    private readonly agentClient: AgentClientContract | undefined,
    private readonly providerFileLifecycle: ProviderFileLifecycle | undefined,
    private readonly tokenizerFactory: RuntimeTokenizerFactory | undefined,
    private readonly contentGeneratorFactory:
      | RuntimeContentGeneratorFactory<ContentGenerator>
      | undefined,
    private readonly runtimeFactoryBindings:
      | AgentRuntimeFactoryBindings
      | undefined,
    private readonly tokenStore: TokenStore | undefined,
    private readonly credentialAuthority: CredentialAuthority | undefined,
    private readonly policyOwner: RuntimePolicyOwner | undefined,
    private readonly trustPort: WorkspaceTrustControlPort | undefined,
    private readonly idePort: WorkspaceIdePort | undefined,
    private readonly hookOwner: SessionHookOwner | undefined,
    private readonly definitionOwner: WorkspaceDefinitionOwner | undefined,
    private readonly filesystemOwner: WorkspaceFilesystemOwner | undefined,
    private readonly lspOwner: WorkspaceLspOwner | undefined,
    private readonly memoryOwner: AgentConfig['memoryOwner'] | undefined,
    private readonly asyncTaskManager: AsyncTaskManager | undefined,
    private readonly mcpHost: Partial<McpHostServices> | undefined,
    private readonly mcpTokenStorage: TokenStorage | undefined,
    private readonly githubBrokerClient: GitHubBrokerClient | undefined,
    private readonly disposeGitHubBroker: (() => Promise<void>) | undefined,
    private readonly imageOperation:
      | SessionImageSelection['imageOperation']
      | undefined,
    private readonly onApproval: ApprovalHandler | undefined,
    private readonly onOAuthPrompt: OAuthPromptHandler | undefined,
    private readonly editorCallbacks: EditorCallbacks | undefined,
    private readonly prepareSessionTools: PrepareSessionTools | undefined,
    private readonly toolSchedulerFactory: AgentSchedulerFactory | undefined,
    private readonly skillPolicy:
      | WorkspaceSkillAssemblyOperations['reloadPolicy']
      | undefined,
    private readonly registerSkillTools:
      | WorkspaceSkillAssemblyOperations['registerTools']
      | undefined,
  ) {}

  async assemble(): Promise<Agent> {
    const images = prepareImageConstruction(this.imageOperation);
    let github: HostGitHubBrokerOwner | undefined;
    const preflight = this.activationPreflight?.operation;
    const closePreflight =
      preflight === undefined
        ? undefined
        : () => AgentActivationBootstrap.close(preflight);
    const definitions = this.definitionOwner;
    const memory = this.memoryOwner;
    try {
      github = assembleHostGitHubBroker({
        githubBrokerClient: this.githubBrokerClient,
        disposeGitHubBroker: this.disposeGitHubBroker,
      });
      this.validatePreflight();
      const messageBus =
        this.messageBus ??
        this.activationPreflight?.operation.messageBus ??
        this.mcpRuntime?.messageBus ??
        this.policyOwner?.session.messageBus;
      const runtimeId = this.validateAdoption(messageBus);
      const credentialAuthority =
        this.credentialAuthority ??
        new HostCredentialOwner(process.env).authority;
      await this.adoptConfig(
        github,
        runtimeId,
        messageBus,
        credentialAuthority,
        images.selection,
      );
    } catch (primaryError) {
      return cleanupFailedFromConfig(
        primaryError,
        github?.cleanupFailedConstruction.bind(github),
        () => images.cleanupFailedConstruction(),
        this.intent.definitionOwnership === 'agent' && definitions !== undefined
          ? () => definitions.dispose()
          : undefined,
        memory?.ownership === 'agent'
          ? () => memory.owner.dispose()
          : undefined,
        closePreflight,
      );
    }
    await closePreflightAfterAdoption(closePreflight, () =>
      this.agent.dispose(),
    );
    return this.agent;
  }

  private validatePreflight(): void {
    if (!isAdoptionConfig(this.config))
      throw new AgentBootstrapError('fromConfig requires an existing Config');
    assertMcpHandoff(
      this.mcpRuntime,
      this.intent.mcpOwnership,
      this.mcpHost,
      this.mcpTokenStorage,
    );
    AgentActivationBootstrap.assertAdoption(
      this.activationPreflight,
      this.config,
      this.intent.activation,
      this.providerManager,
      this.settingsService,
      this.imageOperation,
      this.oauthManager,
      this.messageBus,
      this.tokenizerFactory,
      this.contentGeneratorFactory,
      this.providerFileLifecycle,
      this.memoryOwner !== undefined,
    );
  }

  private validateAdoption(messageBus: MessageBus | undefined): string {
    FromConfigValidatableSchema.parse({
      sessionId: this.intent.sessionId,
      activation: this.intent.activation,
    });
    this.assertBorrowedClient();
    const runtimeId = this.intent.sessionId ?? generateRuntimeId();
    validateAgentRuntimeId(runtimeId);
    this.settingsOwner?.assertSettingsIdentity(this.settingsService);
    if (this.mcpRuntime !== undefined)
      this.mcpRuntime.assertConfig(
        this.config,
        messageBus ?? this.mcpRuntime.messageBus,
      );
    const oauth =
      this.oauthManager ?? this.activationPreflight?.operation.oauthManager;
    if (
      oauth?.runtimeMessageBus !== undefined &&
      messageBus !== undefined &&
      oauth.runtimeMessageBus !== messageBus
    )
      throw new AgentBootstrapError(
        'Borrowed OAuth must retain its selected runtime message bus',
      );
    return runtimeId;
  }

  private assertBorrowedClient(): void {
    AgentActivationBootstrap.assertBorrowedClient(
      this.agentClient,
      this.config,
      this.providerManager,
      this.mcpRuntime !== undefined,
      this.activationPreflight?.operation.sessionClient.getAgentClient(),
    );
  }

  private assertWorkspaceHandoff(): void {
    assertAdoptedWorkspaceHandoff(
      this.mcpRuntime !== undefined,
      this.lspOwner,
      this.intent.lspOwnership,
      this.filesystemOwner,
      this.intent.filesystemOwnership,
      this.memoryOwner,
    );
  }

  private constructMcp(
    messageBus: MessageBus | undefined,
  ): Promise<McpRuntimeOwner> {
    const preflight = this.activationPreflight?.operation;
    const filesystem = this.filesystemOwner ?? preflight?.workspaceFilesystem;
    const definitions = this.definitionOwner ?? preflight?.workspaceDefinitions;
    assertAdoptedWorkspaceRoots(
      this.intent.filesystemOwnership,
      filesystem,
      this.intent.definitionOwnership,
      definitions,
    );
    const feedback = this.mcpHost?.emitFeedback;
    const memory = this.memoryOwner?.owner ?? preflight?.workspaceMemory;
    const memoryOwnership = runtimeOwnership(
      this.memoryOwner !== undefined
        ? this.memoryOwner.ownership === 'agent'
        : preflight?.workspaceMemoryOwnership === 'transferred',
    );
    return McpRuntimeOwner.create(
      {
        getAuthProviderFactory: this.mcpHost?.getAuthProviderFactory,
        tokenStorage: new MCPOAuthTokenStorage(
          this.mcpTokenStorage ??
            new KeychainTokenStorage('llxprt-cli-mcp-oauth', feedback),
        ),
        openBrowser: this.mcpHost?.openBrowser ?? openBrowserSecurely,
      },
      this.config,
      messageBus,
      { emitFeedback: feedback },
      undefined,
      undefined,
      this.policyOwner,
      runtimeOwnership(this.policyOwner === undefined),
      this.lspOwner,
      selectedOwnership(this.intent.lspOwnership, this.lspOwner === undefined),
      filesystem,
      selectedOwnership(
        this.intent.filesystemOwnership,
        preflight !== undefined || filesystem === undefined,
      ),
      memory === undefined
        ? undefined
        : { owner: memory, ownership: memoryOwnership },
      definitions,
      selectedOwnership(
        this.intent.definitionOwnership,
        preflight !== undefined || definitions === undefined,
      ),
      this.trustPort ?? preflight?.workspaceTrust,
      this.idePort,
      preflight?.trustCleanup,
      {
        reloadPolicy: this.skillPolicy ?? DEFAULT_SKILL_OPERATIONS.reloadPolicy,
        registerTools:
          this.registerSkillTools ?? DEFAULT_SKILL_OPERATIONS.registerTools,
      },
      this.settingsOwner?.readMcpSettingsBinding(),
    );
  }

  private agent!: Agent;
  private client!: SessionClientOwner;
  private mcp!: McpRuntimeOwner;
  private media: SessionMediaOwner | undefined;
  private selectedSettings!: SessionSettingsOwner;
  private files!: ProviderFileLifecycle;
  private manager!: RuntimeProviderManager;
  private oauth!: OAuthManager;
  private tokenizer!: RuntimeTokenizerFactory;
  private content!: RuntimeContentGeneratorFactory<ContentGenerator>;
  private readonly release = new AcquisitionRelease();
  private runtimeId!: string;
  private authority!: CredentialAuthority;
  private github: HostGitHubBrokerOwner | undefined;
  private selectedBus: MessageBus | undefined;
  private images: SessionImageSelection['imageOperation'];

  private async adoptConfig(
    github: HostGitHubBrokerOwner | undefined,
    runtimeId: string,
    messageBus: MessageBus | undefined,
    authority: CredentialAuthority,
    images: SessionImageSelection['imageOperation'],
  ): Promise<void> {
    this.github = github;
    this.runtimeId = runtimeId;
    this.selectedBus = messageBus;
    this.authority = authority;
    this.images = images;
    this.assertWorkspaceHandoff();
    this.mcp = this.mcpRuntime ?? (await this.constructMcp(messageBus));
    this.media = await acquireAdoptedMedia(
      this.config,
      this.activationPreflight?.operation,
      this.agentClient?.mediaStore,
    );
    try {
      this.acquireProviders();
      this.acquireOAuth();
    } catch (primary) {
      await cleanupFailedAdoption(
        primary,
        () => this.release.rollback(),
        adoptedDefinitionCleanup(
          this.mcp,
          this.definitionOwner,
          this.intent.definitionOwnership,
          this.ownsMcp(),
        ),
        this.media === undefined
          ? undefined
          : this.media.dispose.bind(this.media),
        undefined,
      );
    }
    await this.complete();
  }

  private acquireProviders(): void {
    const preflight = this.activationPreflight?.operation;
    const transferred = preflight?.takeSettingsOwner(this.settingsService);
    const settingsOwner =
      transferred ??
      this.settingsOwner ??
      new SessionSettingsOwner(this.settingsService);
    this.selectedSettings = settingsOwner;
    if (
      (transferred !== undefined &&
        preflight?.settingsOwnerOwnership === 'transferred') ||
      (transferred === undefined && this.settingsOwner === undefined)
    )
      this.release.acquire('settings', () => settingsOwner.dispose());
    settingsOwner.bindTelemetry(this.config);
    const files =
      this.providerFileLifecycle ??
      preflight?.providerFileLifecycle ??
      new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
        proxy: this.config.getProxy(),
      });
    this.files = files;
    const scope = this.config.getSessionId();
    for (const id of this.runtimeId === scope
      ? [scope]
      : [this.runtimeId, scope])
      this.release.acquire('files', () => releaseAdoptedFileScope(files, id));
    this.manager = acquireAdoptedProviderManager(
      this.providerManager,
      this.config,
      this.settingsService,
      settingsOwner,
      files,
      this.runtimeId,
      this.authority,
      this.release,
    );
  }

  private acquireOAuth(): void {
    const preflight = this.activationPreflight?.operation;
    this.tokenizer = configureProviderTokenizer(
      this.manager,
      this.tokenizerFactory ?? preflight?.tokenizerFactory,
    );
    this.content =
      this.contentGeneratorFactory ??
      preflight?.contentGeneratorFactory ??
      createRuntimeContentGeneratorFactory();
    this.oauth = acquireAdoptedOAuth(
      this.oauthManager ?? preflight?.oauthManager,
      this.tokenStore,
      this.mcp.messageBus,
      this.config,
      this.settingsService,
      this.manager,
      this.runtimeId,
      this.definitionOwner?.profileReads ??
        preflight?.workspaceDefinitions.profileReads ??
        this.mcpRuntime?.profileDefinitions,
      this.authority,
      this.release,
    );
  }

  private ownsMcp(): boolean {
    return (
      (this.intent.mcpOwnership ??
        (this.mcpRuntime === undefined ? 'agent' : 'caller')) === 'agent'
    );
  }

  private async complete(): Promise<void> {
    let client: SessionClientOwner | undefined;
    try {
      client = await initializeAdoptedClient(
        this.config,
        this.settingsService,
        this.selectedSettings,
        this.manager,
        this.oauth,
        this.content,
        this.tokenizer,
        this.files,
        this.media,
        this.mcp.readInstructions,
        this.mcp.workspacePaths,
        this.intent.activation,
        this.activationPreflight,
        this.runtimeFactoryBindings?.agentClientFactory,
        this.agentClient,
        this.policyOwner === undefined && this.mcpRuntime !== undefined
          ? undefined
          : this.selectedBus,
        this.images,
      );
      this.client = client;
      await this.initializeSession();
      await this.finalize();
    } catch (primary) {
      await cleanupFailedAdoption(
        primary,
        () => this.release.close(),
        adoptedDefinitionCleanup(
          this.mcp,
          this.definitionOwner,
          this.intent.definitionOwnership,
          this.ownsMcp(),
        ),
        this.media === undefined
          ? undefined
          : this.media.dispose.bind(this.media),
        client?.dispose.bind(client),
      );
    }
  }

  private async initializeSession(): Promise<void> {
    const client = this.client;
    client.bindHostGitHub(this.github);
    const definitions = this.definitionOwner ?? this.mcp.workspaceDefinitions;
    const registration = createTaskRegistration(this.authority);
    client.bindMcpRuntime(
      this.mcp,
      this.runtimeFactoryBindings?.taskToolRegistration(registration) ??
        registration,
      definitions.profileReads,
      projectTrustedSubagents(definitions, () =>
        this.mcp.trust.isTrustedFolder(),
      ),
    );
    if (client.hasHookComposition()) {
      if (this.hookOwner !== undefined)
        throw new AgentBootstrapError(
          'Preflight hook ownership cannot be replaced during adoption',
        );
    } else client.bindHooks(this.hookOwner);
    await activateAdoptedProviders(
      this.config,
      this.settingsService,
      this.selectedSettings,
      this.manager,
      this.oauth,
      this.runtimeId,
      this.providerManager === undefined,
      this.tokenizer,
    );
    await this.mcp.initialize();
    await client.initializeTools();
    const prepare = this.prepareSessionTools;
    if (prepare !== undefined)
      client.toolCatalog.prepareTools((tools) =>
        prepare(this.config, client.messageBus, tools),
      );
  }

  private async finalize(): Promise<void> {
    await activateAdoptedSession(
      this.config,
      this.settingsService,
      this.selectedSettings,
      this.manager,
      this.oauth,
      () => 'agent',
      () => this.client.getAgentClient().isInitialized(),
      (method) => this.client.refreshAuth(method),
      this.intent.activation,
      this.activationPreflight,
    );
    const parsed = {
      provider:
        this.providerManager?.getActiveProviderName() ??
        this.config.getProvider() ??
        '',
      model:
        this.selectedSettings.readSelectedModel() ?? this.config.getModel(),
      ...(this.intent.sessionId === undefined
        ? {}
        : { sessionId: this.intent.sessionId }),
    };
    await this.tokenizer.prepareTokenizer?.(parsed.provider, parsed.model);
    const handles: AgentSchedulerHandle[] = [];
    const scheduler = resolveSchedulerFactory(
      false,
      this.toolSchedulerFactory,
      handles,
    );
    this.agent = await this.#acquireFacade(
      parsed,
      { baseUrl: admittedEndpoint(this.settingsService, parsed.provider) }
        .baseUrl,
      handles,
      scheduler,
    );
  }

  async #acquireFacade(
    parsed: Parameters<typeof buildFacadeState>[0] & {
      readonly auth?: AgentAuth;
    },
    baseUrl: string | undefined,
    handles: AgentSchedulerHandle[],
    scheduler: SchedulerConstruction | undefined,
  ): Promise<Agent> {
    const tasks = assembleTaskOwner(
      this.settingsService,
      this.asyncTaskManager,
    );
    const shell = new ShellJobOwner(() =>
      resolveShellJobSettings(this.settingsService),
    );
    const child = new ChildToolDisplay();
    const display: StableDisplayCallbacksHolder = {};
    try {
      const editors = { editorCallbacks: this.editorCallbacks ?? {} };
      this.client.initializeExecution(
        withChildToolDisplay(
          scheduler ?? ((options) => new CoreToolScheduler(options)),
          child,
          tasks,
          shell,
        ),
        this.onApproval ? wrapApprovalHandler(this.onApproval) : undefined,
        createStableDisplayCallbacks(editors, display),
      );
      const runtimeState = buildFacadeState(parsed, baseUrl, this.runtimeId);
      const ownership = recordOwnership({
        runtimeHandle: { cleanup: () => this.release.close() },
        injectedSchedulerHandles: handles,
        configOwnership: 'caller',
        disposeMcpRuntime: adoptedDefinitionCleanup(
          this.mcp,
          this.definitionOwner,
          this.intent.definitionOwnership,
          this.ownsMcp(),
        ),
      });
      return this.#constructFacade(
        runtimeState,
        ownership,
        parsed.auth,
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
  #constructMcpControl(auth: AgentAuthState): McpControl {
    return buildOwnedMcpControl(
      (...args) => this.mcp.readServerSettings(...args),
      this.client.toolCatalog.selection,
      (...args) => this.mcp.listPrompts(...args),
      (...args) => this.mcp.listResources(...args),
      (...args) => this.mcp.readOAuthCredentials(...args),
      (...args) => this.mcp.performOAuth(...args),
      (...args) => this.mcp.status(...args),
      (...args) => this.mcp.refresh(...args),
      (...args) => this.mcp.reload(...args),
      (server) => auth.mcpAuth.has(server),
      (server) => auth.mcpAuth.add(server),
      () => this.client.getAgentClient().setTools(),
      (...args) => this.mcp.subscribeStatus(...args),
      (...args) => this.mcp.findResource(...args),
      (...args) => this.mcp.readResource(...args),
    );
  }
  #constructWorkspace(): WorkspaceControl {
    const definitions = this.definitionOwner ?? this.mcp.workspaceDefinitions;
    return new WorkspaceControl(
      definitions.profileReads,
      definitions.profileWrites,
      projectTrustedSubagents(definitions, () =>
        this.mcp.trust.isTrustedFolder(),
      ),
      definitions.subagentWrites,
      this.mcp.checkpointOperations,
      this.mcp.workspaceIgnore,
      this.mcp.workspaceSearch,
      this.mcp.workspaceFiles,
      this.mcp.workspacePaths.contains,
      this.mcp.workspacePaths.directories,
      this.mcp.addWorkspaceDirectory,
      this.config.getTargetDir(),
      this.config.getProjectRoot(),
    );
  }
  #closeMcpAdmission(): void {
    if (this.intent.definitionOwnership === 'agent')
      this.definitionOwner?.closeAdmission();
    if (this.ownsMcp()) this.mcp.closeAdmission();
  }
  #constructFacade(
    runtimeState: ReturnType<typeof buildFacadeState>,
    ownership: ReturnType<typeof recordOwnership>,
    initialAuth: AgentAuth | undefined,
    tasks: TaskLaunchOwner,
    shell: ShellJobOwner,
    child: ChildToolDisplay,
    editors: StableEditorCallbacksHolder,
    display: StableDisplayCallbacksHolder,
  ): Agent {
    const history =
      this.client.getAgentClient().getHistoryService() ?? new HistoryService();
    this.client.getAgentClient().storeHistoryServiceForReuse(history);
    const auth = createAgentAuthState();
    return new AgentImpl(
      this.selectedSettings,
      this.client,
      this.mcp.workspaceSkills.operations,
      undefined,
      this.media,
      tasks,
      shell,
      this.#constructWorkspace(),
      assembleIdeControl(
        this.mcp.trust,
        this.mcp.ide,
        () => editors.editorCallbacks,
      ),
      new LspControl(this.mcp.lspInspection),
      () => {
        if (ownership.disposed) throw new Error('MCP facade is closed');
        return this.mcp.awaitDiscovery();
      },
      () => this.#closeMcpAdmission(),
      this.#constructMcpControl(auth),
      auth,
      this.config,
      this.manager,
      this.oauth,
      () => 'agent',
      this.settingsService,
      this.runtimeId,
      () => this.release.close(),
      this.client.messageBus,
      runtimeState,
      ownership,
      this.intent.sessionIdentityOwnership ?? 'facade',
      () => this.client.getAgentClient(),
      history,
      editors,
      display,
      this.onOAuthPrompt,
      initialAuth,
      child,
      async (model) => {
        await setActiveModel(
          model,
          assembleModelSelection(this.selectedSettings),
          this.settingsService,
          this.manager.getActiveProvider(),
        );
      },
      assembleSessionAuthentication(this.oauth, (provider) =>
        clearProviderAuthenticationCache(
          this.manager.getProviderByName(provider),
        ),
      ),
    );
  }
}

function isAdoptionConfig(value: unknown): boolean {
  return value instanceof Config;
}
