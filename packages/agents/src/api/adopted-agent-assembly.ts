/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config } from '@vybestack/llxprt-code-core';
import { openBrowserSecurely } from '@vybestack/llxprt-code-core';
import { resolveShellJobSettings } from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  KeychainTokenStorage,
  MCPOAuthTokenStorage,
  McpClientManager,
} from '@vybestack/llxprt-code-mcp';
import { defaultFeedbackSink } from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  HostCredentialOwner,
  type CredentialAuthority,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { type SettingsService } from '@vybestack/llxprt-code-settings';
import { admittedEndpoint } from '../core/admittedRouteSecurity.js';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
import { type SchedulerConstruction } from '../session/assembleSchedulerOwner.js';
import { withChildToolDisplay } from '../session/childToolAssembly.js';
import { ChildToolDisplay } from '../session/childToolDisplay.js';
import { cleanupProviderScope } from '../session/session-client-cleanup.js';
import { type SessionClientOwner } from '../session/session-client-owner.js';
import { ShellJobOwner } from '../session/shell-job-owner.js';
import { type TaskLaunchOwner } from '../session/task-launch-owner.js';
import { releaseAdoptedFileScope } from './adoption-release.js';
import {
  assembleTaskOwner,
  cleanupFailedShellBootstrap,
} from './agent-shell-assembly.js';
import { type Agent } from './agent.js';
import {
  buildFacadeState,
  createStableDisplayCallbacks,
  generateRuntimeId,
  recordOwnership,
  validateAgentRuntimeId,
  type StableDisplayCallbacksHolder,
  type StableEditorCallbacksHolder,
} from './agentBootstrap.js';
import {
  FromConfigValidatableSchema,
  type AgentAdoptionIntent,
  type AgentAuth,
  type AgentSchedulerHandle,
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
import { cleanupFailedAdoption } from './fromConfig-cleanup.js';
import { AdoptedSessionAssembly } from './fromConfig-session.js';
import { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import { assembleModelSelection } from './model-selection.js';
import { setActiveModel } from './providerMutations.js';
import { acquireAdoptedMedia } from './session-image-assembly.js';
import { projectTrustedSubagents } from './workspace-definition-assembly.js';
import { DEFAULT_SKILL_OPERATIONS } from './workspace-skill-assembly.js';
export abstract class AdoptedAgentAssembly extends AdoptedSessionAssembly {
  protected constructor(config?: Config) {
    super();
    if (config !== undefined) this.config = config;
  }
  protected abstract validateAdoptionIdentity(): void;
  protected abstract publishAdoptedAgent(agent: Agent): Promise<Agent>;
  protected adoptSettingsService!: SettingsService;
  protected adoptIntent!: AgentAdoptionIntent;
  protected adoptCredentialAuthority!: CredentialAuthority | undefined;
  protected async assembleAdoption(): Promise<Agent> {
    this.validateAdoptionIdentity();
    const runtimeId = this.#adoptValidateIntent();
    const credentialAuthority =
      this.adoptCredentialAuthority ??
      new HostCredentialOwner(process.env).authority;
    await this.#adoptAdoptConfig(runtimeId, credentialAuthority);
    return this.publishAdoptedAgent(this.#adoptAgent);
  }
  #adoptValidateIntent(): string {
    FromConfigValidatableSchema.parse({
      sessionId: this.adoptIntent.sessionId,
      activation: this.adoptIntent.activation,
    });
    const runtimeId = this.adoptIntent.sessionId ?? generateRuntimeId();
    validateAgentRuntimeId(runtimeId);
    return runtimeId;
  }
  #adoptConstructMcp(): Promise<McpRuntimeOwner> {
    const feedback = defaultFeedbackSink;
    return McpRuntimeOwner.create(
      {
        oauth: {
          getAuthProviderFactory: undefined,
          tokenStorage: new MCPOAuthTokenStorage(
            new KeychainTokenStorage('llxprt-cli-mcp-oauth', feedback),
          ),
          openBrowser: openBrowserSecurely,
        },
        config: this.config,
        managerFactory: McpClientManager,
        extensionLoader: undefined,
        policy: undefined,
        lspOwner: undefined,
        lspOwnership: 'runtime',
        filesystemOwner: undefined,
        filesystemOwnership: 'runtime',
        filesystemService: undefined,
        memoryOwner: undefined,
        definitionOwner: undefined,
        definitionOwnership: 'runtime',
        trustPort: undefined,
        trustCleanup: undefined,
        idePort: undefined,
      },
      {
        emitFeedback: feedback,
        skillOperations: DEFAULT_SKILL_OPERATIONS,
        mcpSettings: undefined,
      },
    );
  }
  #adoptAgent!: Agent;
  protected readonly adoptRelease = new AcquisitionRelease();
  async #adoptAdoptConfig(
    runtimeId: string,
    authority: CredentialAuthority,
  ): Promise<void> {
    this.adoptRuntimeId = runtimeId;
    this.adoptAuthority = authority;
    this.adoptMcp = await this.#adoptConstructMcp();
    try {
      this.adoptMedia = acquireAdoptedMedia(this.config);
      this.#adoptAcquireProviders();
      this.#adoptAcquireOAuth();
    } catch (primary) {
      await cleanupFailedAdoption(
        primary,
        () => this.adoptRelease.rollback(),
        () => this.adoptMcp.dispose(),
        this.adoptMedia === undefined
          ? undefined
          : this.adoptMedia.dispose.bind(this.adoptMedia),
        undefined,
      );
    }
    await this.#adoptComplete();
  }
  #adoptAcquireProviders(): void {
    const settingsOwner = new SessionSettingsOwner(this.adoptSettingsService);
    this.adoptSelectedSettings = settingsOwner;
    this.adoptRelease.acquire('settings', () => settingsOwner.dispose());
    settingsOwner.bindTelemetry(this.config);
    const files = new ProviderFileLifecycle({
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
    this.adoptTokenizer = configureProviderTokenizer(
      this.adoptManager,
      undefined,
    );
    this.adoptContent = createRuntimeContentGeneratorFactory();
    this.adoptOAuthBus = this.adoptMcp.messageBus;
    this.acquireAdoptedOAuth();
  }
  async #adoptComplete(): Promise<void> {
    let client: SessionClientOwner | undefined;
    try {
      await this.acquireAdoptedSession();
      client = this.adoptClient;
      await this.#adoptInitializeSession();
      await this.#adoptFinalize();
    } catch (primary) {
      await cleanupFailedAdoption(
        primary,
        () => this.adoptRelease.close(),
        () => this.adoptMcp.dispose(),
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
    const definitions = this.adoptMcp.workspaceDefinitions;
    client.bindMcpRuntime(
      this.adoptMcp,
      undefined,
      definitions.profileReads,
      projectTrustedSubagents(definitions, () =>
        this.adoptMcp.trust.isTrustedFolder(),
      ),
    );
    if (!client.hasHookComposition()) client.bindHooks();
    await this.activateAdoptedProviders();
    await this.adoptMcp.initialize();
    await client.initializeTools();
  }
  async #adoptFinalize(): Promise<void> {
    await this.activateAdoptedSession();
    const parsed = {
      provider:
        this.adoptManager.getActiveProviderName() ??
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
    const scheduler = resolveSchedulerFactory(false, undefined, handles);
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
    const tasks = assembleTaskOwner(this.adoptSettingsService, undefined);
    const shell = new ShellJobOwner(() =>
      resolveShellJobSettings(this.adoptSettingsService),
    );
    const child = new ChildToolDisplay();
    const display: StableDisplayCallbacksHolder = {};
    try {
      const editors = { editorCallbacks: {} };
      this.adoptClient.toolCatalog.bindChildExecution(child, tasks, shell);
      this.adoptClient.initializeExecution(
        withChildToolDisplay(
          scheduler ?? ((options) => new CoreToolScheduler(options)),
          child,
          tasks,
          shell,
        ),
        undefined,
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
        disposeMcpRuntime: () => this.adoptMcp.dispose(),
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
      undefined,
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
    this.closeMcpAdmission = () => this.adoptMcp.closeAdmission();
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
    this.sessionIdentityOwnership = 'facade';

    this.facadeEditors = editors;
    this.facadeDisplay = display;
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
