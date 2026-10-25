/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config } from '@vybestack/llxprt-code-core';
import {
  openBrowserSecurely,
  type AgentRuntimeFactoryBindings,
  type ContentGenerator,
  type MessageBus,
  type RuntimeContentGeneratorFactory,
  type RuntimeProviderManager,
  type RuntimeTokenizerFactory,
  type WorkspaceDefinitionOwner,
  type WorkspaceIdePort,
  type WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';
import { resolveShellJobSettings } from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';
import { type WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { type AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { type SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { type WorkspaceLspOwner } from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
import { type RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { type AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import { type WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  KeychainTokenStorage,
  MCPOAuthTokenStorage,
  McpClientManager,
  type TokenStorage,
} from '@vybestack/llxprt-code-mcp';
import {
  defaultFeedbackSink,
  type McpHostServices,
} from '@vybestack/llxprt-code-mcp/host/hostServices.js';
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
import { type SettingsService } from '@vybestack/llxprt-code-settings';
import { type GitHubBrokerClient } from '@vybestack/llxprt-code-tools';
import { admittedEndpoint } from '../core/admittedRouteSecurity.js';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
import { type SchedulerConstruction } from '../session/assembleSchedulerOwner.js';
import { withChildToolDisplay } from '../session/childToolAssembly.js';
import { ChildToolDisplay } from '../session/childToolDisplay.js';
import { assertBorrowedSessionClient } from '../session/session-client-binding.js';
import { cleanupProviderScope } from '../session/session-client-cleanup.js';
import { type SessionClientOwner } from '../session/session-client-owner.js';
import { ShellJobOwner } from '../session/shell-job-owner.js';
import { type TaskLaunchOwner } from '../session/task-launch-owner.js';
import { type ActivationPreflight } from './activation-types.js';
import { adoptedDefinitionCleanup } from './adopted-definition-assembly.js';
import { releaseAdoptedFileScope } from './adoption-release.js';
import {
  assembleTaskOwner,
  cleanupFailedShellBootstrap,
} from './agent-shell-assembly.js';
import { type Agent } from './agent.js';
import {
  AgentBootstrapError,
  buildFacadeState,
  createStableDisplayCallbacks,
  generateRuntimeId,
  recordOwnership,
  validateAgentRuntimeId,
  wrapApprovalHandler,
  type StableDisplayCallbacksHolder,
  type StableEditorCallbacksHolder,
} from './agentBootstrap.js';
import {
  FromConfigValidatableSchema,
  type AgentAdoptionIntent,
  type AgentAuth,
  type AgentConfig,
  type AgentSchedulerFactory,
  type AgentSchedulerHandle,
  type ApprovalHandler,
  type EditorCallbacks,
  type OAuthPromptHandler,
} from './config-types.js';
import { createAgentAuthState } from './control/authState.js';
import { assembleIdeControl } from './control/ideControl.js';
import { LspControl } from './control/lspControl.js';
import {
  assembleSessionAuthentication,
  clearProviderAuthenticationCache,
} from './control/session-authentication.js';
import { resolveSchedulerFactory } from '../session/assembleSchedulerOwner.js';
import { assembleForegroundMcpControl } from './foreground-agent-assembly.js';
import { assembleForegroundWorkspace } from './foreground-workspace-control.js';
import {
  cleanupFailedAdoption,
  cleanupFailedFromConfig,
  closePreflightAfterAdoption,
} from './fromConfig-cleanup.js';
import { AdoptedSessionAssembly } from './fromConfig-session.js';
import { type PrepareSessionTools } from './fromConfig.js';
import {
  assembleHostGitHubBroker,
  type HostGitHubBrokerOwner,
} from './host-github-broker-owner.js';
import {
  assertAdoptedWorkspaceHandoff,
  assertAdoptedWorkspaceRoots,
  runtimeOwnership,
  selectedOwnership,
} from './mcpOAuthAssembly.js';
import type {
  McpPolicyHandoff,
  McpRuntimeOperations,
} from './mcp-runtime-construction.js';
import { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import { assembleModelSelection } from './model-selection.js';
import { setActiveModel } from './providerMutations.js';
import {
  acquireAdoptedMedia,
  prepareImageConstruction,
  type SessionImageSelection,
} from './session-image-assembly.js';
import { projectTrustedSubagents } from './workspace-definition-assembly.js';
import { DEFAULT_SKILL_OPERATIONS } from './workspace-skill-assembly.js';
export abstract class AdoptedAgentAssembly extends AdoptedSessionAssembly {
  protected constructor(config?: Config) {
    super();
    if (config !== undefined) this.config = config;
  }
  protected abstract validateAdoptionIdentity(): void;
  protected abstract acceptAdoption(): Promise<void>;
  protected abstract closeAcquisition(): Promise<void>;
  protected abstract publishAdoptedAgent(agent: Agent): Promise<Agent>;
  protected adoptSettingsService!: SettingsService;
  protected adoptIntent!: AgentAdoptionIntent;
  protected adoptSettingsOwner!: SessionSettingsOwner | undefined;
  protected adoptProviderManager!: RuntimeProviderManager | undefined;
  protected adoptOauthManager!: OAuthManager | undefined;
  protected adoptMessageBus!: MessageBus | undefined;
  protected adoptMcpRuntime!: McpRuntimeOwner | undefined;
  protected adoptActivationPreflight!: ActivationPreflight | undefined;
  protected adoptAgentClient!: AgentClientContract | undefined;
  protected adoptProviderFileLifecycle!: ProviderFileLifecycle | undefined;
  protected adoptTokenizerFactory!: RuntimeTokenizerFactory | undefined;
  protected adoptContentGeneratorFactory!:
    | RuntimeContentGeneratorFactory<ContentGenerator>
    | undefined;
  protected adoptRuntimeFactoryBindings!:
    | AgentRuntimeFactoryBindings
    | undefined;
  protected adoptCredentialAuthority!: CredentialAuthority | undefined;
  protected adoptPolicyOwner!: RuntimePolicyOwner | undefined;
  protected adoptTrustPort!: WorkspaceTrustControlPort | undefined;
  protected adoptIdePort!: WorkspaceIdePort | undefined;
  protected adoptHookOwner!: SessionHookOwner | undefined;
  protected adoptDefinitionOwner!: WorkspaceDefinitionOwner | undefined;
  protected adoptFilesystemOwner!: WorkspaceFilesystemOwner | undefined;
  protected adoptLspOwner!: WorkspaceLspOwner | undefined;
  protected adoptMemoryOwner!: AgentConfig['memoryOwner'] | undefined;
  protected adoptAsyncTaskManager!: AsyncTaskManager | undefined;
  protected adoptMcpHost!: Partial<McpHostServices> | undefined;
  protected adoptMcpTokenStorage!: TokenStorage | undefined;
  protected adoptGithubBrokerClient!: GitHubBrokerClient | undefined;
  protected adoptDisposeGitHubBroker!: (() => Promise<void>) | undefined;
  protected adoptImageOperation!:
    | SessionImageSelection['imageOperation']
    | undefined;
  protected adoptOnApproval!: ApprovalHandler | undefined;
  protected adoptOnOAuthPrompt!: OAuthPromptHandler | undefined;
  protected adoptEditorCallbacks!: EditorCallbacks | undefined;
  protected adoptPrepareSessionTools!: PrepareSessionTools | undefined;
  protected adoptToolSchedulerFactory!: AgentSchedulerFactory | undefined;
  protected adoptSkillPolicy!:
    | WorkspaceSkillAssemblyOperations['reloadPolicy']
    | undefined;
  protected adoptRegisterSkillTools!:
    | WorkspaceSkillAssemblyOperations['registerTools']
    | undefined;
  protected async assembleAdoption(): Promise<Agent> {
    const images = prepareImageConstruction(this.adoptImageOperation);
    let github: HostGitHubBrokerOwner | undefined;
    const preflight =
      this.adoptActivationPreflight === undefined ? undefined : this;
    const closePreflight =
      preflight === undefined ? undefined : () => this.closeAcquisition();
    try {
      github = assembleHostGitHubBroker({
        githubBrokerClient: this.adoptGithubBrokerClient,
        disposeGitHubBroker: this.adoptDisposeGitHubBroker,
      });
      this.validateAdoptionIdentity();
      const retainedBus =
        this.adoptActivationPreflight === undefined
          ? undefined
          : this.messageBus;
      const messageBus =
        this.adoptMessageBus ??
        retainedBus ??
        this.adoptMcpRuntime?.messageBus ??
        this.adoptPolicyOwner?.session.messageBus;
      const runtimeId = this.#adoptValidateAdoption(messageBus);
      this.#adoptAssertWorkspaceHandoff();
      if (preflight !== undefined) {
        await this.acceptAdoption();
      }
      const credentialAuthority =
        this.adoptCredentialAuthority ??
        new HostCredentialOwner(process.env).authority;
      await this.#adoptAdoptConfig(
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
        this.adoptIntent.definitionOwnership === 'agent' &&
          this.adoptDefinitionOwner !== undefined
          ? this.adoptDefinitionOwner.dispose.bind(this.adoptDefinitionOwner)
          : undefined,
        this.adoptMemoryOwner?.ownership === 'agent'
          ? this.adoptMemoryOwner.owner.dispose.bind(
              this.adoptMemoryOwner.owner,
            )
          : undefined,
        closePreflight,
      );
    }
    await closePreflightAfterAdoption(closePreflight, () =>
      this.#adoptAgent.dispose(),
    );
    return this.publishAdoptedAgent(this.#adoptAgent);
  }
  #adoptValidateAdoption(messageBus: MessageBus | undefined): string {
    FromConfigValidatableSchema.parse({
      sessionId: this.adoptIntent.sessionId,
      activation: this.adoptIntent.activation,
    });
    this.#adoptAssertBorrowedClient();
    const runtimeId = this.adoptIntent.sessionId ?? generateRuntimeId();
    validateAgentRuntimeId(runtimeId);
    this.adoptSettingsOwner?.assertSettingsIdentity(this.adoptSettingsService);
    if (this.adoptMcpRuntime !== undefined)
      this.adoptMcpRuntime.assertConfig(
        this.config,
        messageBus ?? this.adoptMcpRuntime.messageBus,
      );
    const oauth =
      this.adoptOauthManager ??
      (this.adoptActivationPreflight === undefined
        ? undefined
        : this.oauthManager);
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
  #adoptAssertBorrowedClient(): void {
    assertBorrowedSessionClient(
      this.adoptAgentClient,
      this.config,
      this.adoptProviderManager,
      this.adoptMcpRuntime !== undefined,
      undefined,
    );
    if (this.adoptActivationPreflight !== undefined)
      this.ownedSessionClient.assertPreflightClient(this.adoptAgentClient);
  }
  #adoptAssertWorkspaceHandoff(): void {
    assertAdoptedWorkspaceHandoff(
      this.adoptMcpRuntime !== undefined,
      this.adoptLspOwner,
      this.adoptIntent.lspOwnership,
      this.adoptFilesystemOwner,
      this.adoptIntent.filesystemOwnership,
      this.adoptMemoryOwner,
    );
  }
  #adoptConstructMcp(
    messageBus: MessageBus | undefined,
  ): Promise<McpRuntimeOwner> {
    const preflight =
      this.adoptActivationPreflight === undefined ? undefined : this;
    const filesystem =
      this.adoptFilesystemOwner ?? preflight?.workspaceFilesystem;
    const definitions =
      this.adoptDefinitionOwner ?? preflight?.workspaceDefinitions;
    assertAdoptedWorkspaceRoots(
      this.adoptIntent.filesystemOwnership,
      filesystem,
      this.adoptIntent.definitionOwnership,
      definitions,
    );
    const feedback = this.adoptMcpHost?.emitFeedback ?? defaultFeedbackSink;
    const memory = this.adoptMemoryOwner?.owner ?? preflight?.workspaceMemory;
    const memoryOwnership = runtimeOwnership(
      this.adoptMemoryOwner !== undefined
        ? this.adoptMemoryOwner.ownership === 'agent'
        : preflight?.workspaceMemoryOwnership === 'transferred',
    );
    const policy = this.#adoptPolicyHandoff(messageBus);
    return McpRuntimeOwner.create(
      {
        oauth: {
          getAuthProviderFactory: this.adoptMcpHost?.getAuthProviderFactory,
          tokenStorage: new MCPOAuthTokenStorage(
            this.adoptMcpTokenStorage ??
              new KeychainTokenStorage('llxprt-cli-mcp-oauth', feedback),
          ),
          openBrowser: this.adoptMcpHost?.openBrowser ?? openBrowserSecurely,
        },
        config: this.config,
        managerFactory: McpClientManager,
        extensionLoader: undefined,
        policy,
        lspOwner: this.adoptLspOwner,
        lspOwnership: selectedOwnership(
          this.adoptIntent.lspOwnership,
          this.adoptLspOwner === undefined,
        ),
        filesystemOwner: filesystem,
        filesystemOwnership: selectedOwnership(
          this.adoptIntent.filesystemOwnership,
          preflight !== undefined || filesystem === undefined,
        ),
        filesystemService: undefined,
        memoryOwner:
          memory === undefined
            ? undefined
            : { owner: memory, ownership: memoryOwnership },
        definitionOwner: definitions,
        definitionOwnership: selectedOwnership(
          this.adoptIntent.definitionOwnership,
          preflight !== undefined || definitions === undefined,
        ),
        trustPort: this.adoptTrustPort ?? preflight?.workspaceTrust,
        trustCleanup: preflight?.trustCleanup,
        idePort: this.adoptIdePort,
      },
      this.#adoptMcpOperations(feedback),
    );
  }
  #adoptMcpOperations(
    emitFeedback: McpRuntimeOperations['emitFeedback'],
  ): McpRuntimeOperations {
    return {
      emitFeedback,
      skillOperations: {
        reloadPolicy:
          this.adoptSkillPolicy ?? DEFAULT_SKILL_OPERATIONS.reloadPolicy,
        registerTools:
          this.adoptRegisterSkillTools ??
          DEFAULT_SKILL_OPERATIONS.registerTools,
      },
      mcpSettings: this.adoptSettingsOwner?.readMcpSettingsBinding(),
    };
  }
  #adoptPolicyHandoff(
    messageBus: MessageBus | undefined,
  ): McpPolicyHandoff | undefined {
    const owner = this.adoptPolicyOwner;
    if (messageBus !== undefined && owner === undefined)
      throw new Error('MCP policy handoff requires its explicit runtime owner');
    if (messageBus !== undefined && messageBus !== owner?.session.messageBus)
      throw new Error('MCP policy handoff must retain its session MessageBus');
    return owner === undefined ? undefined : { owner, ownership: 'caller' };
  }
  #adoptAgent!: Agent;
  protected readonly adoptRelease = new AcquisitionRelease();
  #adoptGithub: HostGitHubBrokerOwner | undefined;
  async #adoptAdoptConfig(
    github: HostGitHubBrokerOwner | undefined,
    runtimeId: string,
    messageBus: MessageBus | undefined,
    authority: CredentialAuthority,
    images: SessionImageSelection['imageOperation'],
  ): Promise<void> {
    this.#adoptGithub = github;
    this.adoptRuntimeId = runtimeId;
    this.adoptSelectedBus = messageBus;
    this.adoptAuthority = authority;
    this.adoptImages = images;
    this.adoptMcp =
      this.adoptMcpRuntime ?? (await this.#adoptConstructMcp(messageBus));
    try {
      if (this.adoptActivationPreflight !== undefined) {
        this.ownsFilesystem = false;
        this.ownsDefinitions = false;
        this.ownsMemory = false;
        this.adoptMedia = this.mediaOwner;
        this.mediaOwner = undefined;
      } else {
        this.adoptMedia = await acquireAdoptedMedia(
          this.config,
          this.adoptAgentClient?.mediaStore,
        );
      }
      this.#adoptAcquireProviders();
      this.#adoptAcquireOAuth();
    } catch (primary) {
      await cleanupFailedAdoption(
        primary,
        () => this.adoptRelease.rollback(),
        adoptedDefinitionCleanup(
          this.adoptMcp,
          this.adoptDefinitionOwner,
          this.adoptIntent.definitionOwnership,
          this.#adoptOwnsMcp(),
        ),
        this.adoptMedia === undefined
          ? undefined
          : this.adoptMedia.dispose.bind(this.adoptMedia),
        undefined,
      );
    }
    await this.#adoptComplete();
  }
  #adoptAcquireProviders(): void {
    const preflight =
      this.adoptActivationPreflight === undefined ? undefined : this;
    const transferred =
      preflight === undefined ? undefined : this.settingsOwner;
    const settingsOwner =
      transferred ??
      this.adoptSettingsOwner ??
      new SessionSettingsOwner(this.adoptSettingsService);
    this.adoptSelectedSettings = settingsOwner;
    if (
      (transferred !== undefined &&
        preflight?.settingsOwnerOwnership === 'transferred') ||
      (transferred === undefined && this.adoptSettingsOwner === undefined)
    )
      this.adoptRelease.acquire('settings', () => settingsOwner.dispose());
    if (preflight !== undefined) this.ownsSettings = false;
    settingsOwner.bindTelemetry(this.config);
    const files =
      this.adoptProviderFileLifecycle ??
      preflight?.providerFileLifecycle ??
      new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
        proxy: this.config.getProxy(),
      });
    this.adoptFiles = files;
    const scope = this.config.getSessionId();
    for (const id of this.adoptRuntimeId === scope
      ? [scope]
      : [this.adoptRuntimeId, scope])
      this.adoptRelease.acquire('files', () =>
        releaseAdoptedFileScope(files, id),
      );
    this.acquireAdoptedProviderManager();
  }
  #adoptAcquireOAuth(): void {
    const preflight =
      this.adoptActivationPreflight === undefined ? undefined : this;
    this.adoptTokenizer = configureProviderTokenizer(
      this.adoptManager,
      this.adoptTokenizerFactory ??
        preflight?.ownedSessionClient.tokenizerFactory,
    );
    this.adoptContent =
      this.adoptContentGeneratorFactory ??
      preflight?.ownedSessionClient.contentGeneratorFactory ??
      createRuntimeContentGeneratorFactory();
    this.adoptSuppliedOAuth = this.adoptOauthManager ?? preflight?.oauthManager;
    this.adoptOAuthBus = this.adoptMcp.messageBus;
    this.adoptOAuthProfiles =
      this.adoptDefinitionOwner?.profileReads ??
      preflight?.workspaceDefinitions.profileReads ??
      this.adoptMcpRuntime?.profileDefinitions;
    this.acquireAdoptedOAuth();
  }
  #adoptOwnsMcp(): boolean {
    return (
      (this.adoptIntent.mcpOwnership ??
        (this.adoptMcpRuntime === undefined ? 'agent' : 'caller')) === 'agent'
    );
  }
  async #adoptComplete(): Promise<void> {
    let client: SessionClientOwner | undefined;
    try {
      if (this.adoptActivationPreflight === undefined)
        await this.acquireAdoptedSession();
      else {
        this.adoptClient = this.ownedSessionClient;
        this.ownsSessionClient = false;
      }
      client = this.adoptClient;
      await this.#adoptInitializeSession();
      await this.#adoptFinalize();
    } catch (primary) {
      await cleanupFailedAdoption(
        primary,
        () => this.adoptRelease.close(),
        adoptedDefinitionCleanup(
          this.adoptMcp,
          this.adoptDefinitionOwner,
          this.adoptIntent.definitionOwnership,
          this.#adoptOwnsMcp(),
        ),
        this.adoptMedia === undefined
          ? undefined
          : this.adoptMedia.dispose.bind(this.adoptMedia),
        client?.dispose.bind(client),
      );
    }
  }
  async #adoptInitializeSession(): Promise<void> {
    const client = this.adoptClient;
    const mainScope = this.config.getSessionId();
    client.bindProviderFiles(
      this.adoptFiles,
      (provider) => this.adoptOauth.composeRetryOperations(provider),
      (scope) =>
        scope === mainScope
          ? Promise.resolve()
          : cleanupProviderScope(this.adoptFiles, scope),
    );
    client.bindInteractiveAuthRequests((prompt) =>
      this.adoptOauth.requestInteractiveAuth(prompt),
    );
    client.bindHostGitHub(this.#adoptGithub);
    const definitions =
      this.adoptDefinitionOwner ?? this.adoptMcp.workspaceDefinitions;
    client.bindMcpRuntime(
      this.adoptMcp,
      this.adoptRuntimeFactoryBindings?.taskToolRegistration,
      definitions.profileReads,
      projectTrustedSubagents(definitions, () =>
        this.adoptMcp.trust.isTrustedFolder(),
      ),
      this.adoptAuthority,
    );
    if (client.hasHookComposition()) {
      if (this.adoptHookOwner !== undefined)
        throw new AgentBootstrapError(
          'Preflight hook ownership cannot be replaced during adoption',
        );
    } else client.bindHooks(this.adoptHookOwner);
    await this.activateAdoptedProviders();
    await this.adoptMcp.initialize();
    await client.initializeTools();
    const prepare = this.adoptPrepareSessionTools;
    if (prepare !== undefined) client.toolCatalog.prepareTools(prepare);
  }
  async #adoptFinalize(): Promise<void> {
    if (this.adoptActivationPreflight === undefined)
      await this.activateAdoptedSession();
    const parsed = {
      provider:
        this.adoptProviderManager?.getActiveProviderName() ??
        this.config.getProvider() ??
        '',
      model:
        this.adoptSelectedSettings.readSelectedModel() ??
        this.config.getModel(),
      ...(this.adoptIntent.sessionId === undefined
        ? {}
        : { sessionId: this.adoptIntent.sessionId }),
    };
    await this.adoptTokenizer.prepareTokenizer?.(parsed.provider, parsed.model);
    const handles: AgentSchedulerHandle[] = [];
    const scheduler = resolveSchedulerFactory(
      false,
      this.adoptToolSchedulerFactory,
      handles,
    );
    this.assertConstructionOpen();
    this.#adoptAgent = await this.#adoptAcquireFacade(
      parsed,
      { baseUrl: admittedEndpoint(this.adoptSettingsService, parsed.provider) }
        .baseUrl,
      handles,
      scheduler,
    );
  }
  async #adoptAcquireFacade(
    parsed: Parameters<typeof buildFacadeState>[0] & {
      readonly auth?: AgentAuth;
    },
    baseUrl: string | undefined,
    handles: AgentSchedulerHandle[],
    scheduler: SchedulerConstruction | undefined,
  ): Promise<Agent> {
    const tasks = assembleTaskOwner(
      this.adoptSettingsService,
      this.adoptAsyncTaskManager,
    );
    const shell = new ShellJobOwner(() =>
      resolveShellJobSettings(this.adoptSettingsService),
    );
    const child = new ChildToolDisplay();
    const display: StableDisplayCallbacksHolder = {};
    try {
      const editors = { editorCallbacks: this.adoptEditorCallbacks ?? {} };
      this.adoptClient.toolCatalog.bindChildExecution(child, tasks, shell);
      this.adoptClient.initializeExecution(
        withChildToolDisplay(
          scheduler ?? ((options) => new CoreToolScheduler(options)),
          child,
          tasks,
          shell,
        ),
        this.adoptOnApproval
          ? wrapApprovalHandler(this.adoptOnApproval)
          : undefined,
        createStableDisplayCallbacks(editors, display),
      );
      const runtimeState = buildFacadeState(
        parsed,
        baseUrl,
        this.adoptRuntimeId,
      );
      const ownership = recordOwnership({
        runtimeHandle: { cleanup: () => this.adoptRelease.close() },
        injectedSchedulerHandles: handles,
        configOwnership: 'caller',
        disposeMcpRuntime: adoptedDefinitionCleanup(
          this.adoptMcp,
          this.adoptDefinitionOwner,
          this.adoptIntent.definitionOwnership,
          this.#adoptOwnsMcp(),
        ),
      });
      return this.#adoptConstructFacade(
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
  #adoptCloseMcpAdmission(): void {
    if (this.adoptIntent.definitionOwnership === 'agent')
      this.adoptDefinitionOwner?.closeAdmission();
    if (this.#adoptOwnsMcp()) this.adoptMcp.closeAdmission();
  }
  #adoptConstructFacade(
    runtimeState: ReturnType<typeof buildFacadeState>,
    ownership: ReturnType<typeof recordOwnership>,
    initialAuth: AgentAuth | undefined,
    tasks: TaskLaunchOwner,
    shell: ShellJobOwner,
    child: ChildToolDisplay,
    editors: StableEditorCallbacksHolder,
    display: StableDisplayCallbacksHolder,
  ): Agent {
    this.adoptClient.initializeConversation();
    const auth = createAgentAuthState();
    this.facadeSettingsOwner = this.adoptSelectedSettings;
    this.facadeSessionOwner = this.adoptClient;
    this.facadeWorkspaceSkills = this.adoptMcp.workspaceSkills.operations;
    this.facadeMediaOwner = this.adoptMedia;
    this.facadeTaskOwner = tasks;
    this.facadeShellOwner = shell;
    this.workspace = assembleForegroundWorkspace(
      this.adoptMcp,
      this.config,
      this.adoptDefinitionOwner,
    );
    this.ide = assembleIdeControl(
      this.adoptMcp.trust,
      this.adoptMcp.ide,
      () => editors.editorCallbacks,
    );
    this.lsp = new LspControl(this.adoptMcp.lspInspection);
    this.awaitMcpDiscovery = () => {
      if (ownership.disposed) throw new Error('MCP facade is closed');
      return this.adoptMcp.awaitDiscovery();
    };
    this.closeMcpAdmission = () => this.#adoptCloseMcpAdmission();
    this.mcp = assembleForegroundMcpControl(
      this.adoptMcp,
      this.adoptClient.toolCatalog.selection,
      auth,
      () => this.adoptClient.refreshToolDefinitions(),
    );
    this.facadeAuthState = auth;
    this.facadeProviderManager = this.adoptManager;
    this.facadeOAuth = this.adoptOauth;
    this.facadeRuntimeKind = () => 'agent';
    this.facadeSettingsService = this.adoptSettingsService;
    this.facadeRuntimeId = this.adoptRuntimeId;
    this.closeRuntime = () => this.adoptRelease.close();

    this.facadeRuntimeState = runtimeState;
    this.facadeOwnership = ownership;
    this.sessionIdentityOwnership =
      this.adoptIntent.sessionIdentityOwnership ?? 'facade';

    this.facadeEditors = editors;
    this.facadeDisplay = display;
    this.onOAuthPrompt = this.adoptOnOAuthPrompt;
    this.initialAuth = initialAuth;
    this.childDisplay = child;
    this.selectOwnerModel = async (model) => {
      await setActiveModel(
        model,
        assembleModelSelection(this.adoptSelectedSettings),
        this.adoptSettingsService,
        this.adoptManager.getActiveProvider(),
      );
    };
    this.authentication = assembleSessionAuthentication(
      this.adoptOauth,
      (provider) =>
        clearProviderAuthenticationCache(
          this.adoptManager.getProviderByName(provider),
        ),
    );
    return this.initializeFacade();
  }
}
