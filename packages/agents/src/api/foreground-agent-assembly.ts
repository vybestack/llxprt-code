import { buildOwnedMcpControl } from './control/mcpControlWiring.js';
import {
  createAgentAuthState,
  type AgentAuthState,
} from './control/authState.js';
import type { McpControl } from './control/mcpControl.js';
import { WorkspaceControl } from './control/workspaceControl.js';
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
  buildFacadeState,
  createStableDisplayCallbacks,
  recordOwnership,
  type StableDisplayCallbacksHolder,
  type StableEditorCallbacksHolder,
} from './agentBootstrap.js';
import type { AgentAuth } from './config-types.js';
import {
  assembleSessionAuthentication,
  clearProviderAuthenticationCache,
} from './control/session-authentication.js';
import { assembleModelSelection } from './model-selection.js';
import { setActiveModel } from './providerMutations.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  Config,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import { openBrowserSecurely } from '@vybestack/llxprt-code-core';
import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import {
  KeychainTokenStorage,
  MCPOAuthTokenStorage,
} from '@vybestack/llxprt-code-mcp';
import type {
  CredentialAuthority,
  OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { admittedEndpoint } from '../core/admittedRouteSecurity.js';
import { runCleanupSteps } from '../core/subagent-cleanup.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import {
  AgentActivationBootstrap,
  type ActivationPreflightToken,
} from './activationPreflightState.js';
import type { Agent } from './agent.js';
import { AgentImpl } from './agentImpl.js';
import type {
  AgentForegroundHost,
  AgentSchedulerHandle,
  ProviderActivationIntent,
} from './config-types.js';
import { resolveSchedulerFactory } from './createAgent.js';
import { cleanupFailedAdoption } from './fromConfig-cleanup.js';
import { assembleHostGitHubBroker } from './host-github-broker-owner.js';
import { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import { createTaskRegistration } from './runtimeFactories.js';
import { DEFAULT_SKILL_OPERATIONS } from './workspace-skill-assembly.js';

export class ForegroundAgentAssembly {
  private mcp: McpRuntimeOwner | undefined;
  private client: SessionClientOwner | undefined;
  private media: SessionMediaOwner | undefined;
  private agent: Agent | undefined;
  private readonly cancellation = new AbortController();
  private readonly bus;
  constructor(
    private readonly operation: AgentActivationBootstrap,
    private readonly config: Config,
    private readonly token: ActivationPreflightToken,
    private readonly intent: ProviderActivationIntent,
    private readonly host: AgentForegroundHost,
    private readonly settings: SettingsService,
    private readonly settingsOwner: SessionSettingsOwner,
    private readonly manager: RuntimeProviderManager,
    private readonly oauth: OAuthManager,
    private readonly policy: RuntimePolicyOwner | undefined,
    private readonly authority: CredentialAuthority,
    private readonly releaseProviders: () => Promise<void>,
  ) {
    this.bus = operation.messageBus;
  }
  closeAdmission(): void {
    this.cancellation.abort();
  }
  async dispose(): Promise<void> {
    await this.agent?.dispose();
  }
  async assemble(): Promise<Agent> {
    const { config, token, intent, host } = this;
    let broker: ReturnType<typeof assembleHostGitHubBroker>;
    try {
      broker = assembleHostGitHubBroker(host);
      await this.#constructForegroundMcp();
      if (this.mcp === undefined)
        throw new Error('Foreground MCP is not acquired');
      this.cancellation.signal.throwIfAborted();
      const client = this.operation.takeSessionClient(config);
      this.client = client;
      this.media = this.operation.takeMediaOwner(config);
      this.operation.takeSettingsOwner(this.settings);
      client.bindHostGitHub(broker);
      client.bindMcpRuntime(
        this.mcp,
        createTaskRegistration(this.authority),
        this.mcp.profileDefinitions,
        this.mcp.subagentDefinitions,
      );
      if (!client.hasHookComposition()) client.bindHooks();
      await this.mcp.initialize();
      await client.initializeTools();
      this.cancellation.signal.throwIfAborted();
      AgentActivationBootstrap.consume(
        { operation: this.operation, token },
        config,
        intent,
        this.manager,
        this.settings,
      );
      const agent = await this.#finishForeground();
      this.agent = agent;
      this.cancellation.signal.throwIfAborted();
      await this.operation.dispose();
      host.onSkills?.(this.mcp.workspaceSkills.operations);
      host.onExtensionRestart?.(
        this.mcp.extensionOperations.restart.bind(this.mcp.extensionOperations),
      );
      return agent;
    } catch (primary) {
      const agent = this.agent;
      if (agent !== undefined) {
        try {
          await agent.dispose();
        } catch (cleanup) {
          throw new AggregateError(
            [primary, cleanup],
            'Foreground publication and cleanup failed',
          );
        }
        throw primary;
      }
      return cleanupFailedAdoption(
        primary,
        () =>
          runCleanupSteps([
            () => this.releaseProviders(),
            () => this.operation.dispose(),
            () => broker?.cleanupFailedConstruction(),
            () => config.dispose(),
          ]),
        this.mcp?.dispose.bind(this.mcp),
        this.media?.dispose.bind(this.media),
        this.client?.dispose.bind(this.client),
      );
    }
  }

  async #constructForegroundMcp(): Promise<void> {
    const transport = this.host.mcpHost;
    const mcp = await McpRuntimeOwner.create(
      {
        getAuthProviderFactory: transport?.getAuthProviderFactory,
        tokenStorage: new MCPOAuthTokenStorage(
          new KeychainTokenStorage(
            'llxprt-cli-mcp-oauth',
            transport?.emitFeedback,
          ),
        ),
        openBrowser: transport?.openBrowser ?? openBrowserSecurely,
      },
      this.config,
      this.bus,
      { emitFeedback: transport?.emitFeedback },
      undefined,
      undefined,
      this.policy,
      'caller',
      undefined,
      'runtime',
      this.operation.workspaceFilesystem,
      'runtime',
      {
        owner: this.operation.workspaceMemory,
        ownership:
          this.operation.workspaceMemoryOwnership === 'transferred'
            ? 'runtime'
            : 'caller',
      },
      this.operation.workspaceDefinitions,
      'runtime',
      this.operation.workspaceTrust,
      undefined,
      this.operation.trustCleanup,
      {
        reloadPolicy:
          this.host.skillPolicy ?? DEFAULT_SKILL_OPERATIONS.reloadPolicy,
        registerTools:
          this.host.registerSkillTools ??
          DEFAULT_SKILL_OPERATIONS.registerTools,
      },
      this.settingsOwner.readMcpSettingsBinding(),
    );
    this.mcp = mcp;
  }

  async #finishForeground(): Promise<Agent> {
    const handles: AgentSchedulerHandle[] = [];
    const provider =
      this.manager.getActiveProviderName() ?? this.config.getProvider() ?? '';
    const model =
      this.settingsOwner.readSelectedModel() ?? this.config.getModel();
    await this.operation.tokenizerFactory.prepareTokenizer?.(provider, model);
    return this.#acquireFacade(
      { provider, model },
      admittedEndpoint(this.settings, provider),
      handles,
      resolveSchedulerFactory(false, undefined, handles),
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
    if (this.client === undefined)
      throw new Error('Foreground client is not acquired');
    const tasks = assembleTaskOwner(this.settings, undefined);
    const shell = new ShellJobOwner(() =>
      resolveShellJobSettings(this.settings),
    );
    const child = new ChildToolDisplay();
    const display: StableDisplayCallbacksHolder = {};
    try {
      const editors = { editorCallbacks: {} };
      this.client.initializeExecution(
        withChildToolDisplay(
          scheduler ?? ((options) => new CoreToolScheduler(options)),
          child,
          tasks,
          shell,
        ),
        undefined,
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
  #constructMcpControl(auth: AgentAuthState): McpControl {
    if (this.client === undefined || this.mcp === undefined)
      throw new Error('Foreground controls are not acquired');
    return buildOwnedMcpControl(
      this.mcp.readServerSettings.bind(this.mcp),
      this.client.toolCatalog.selection,
      this.mcp.listPrompts.bind(this.mcp),
      this.mcp.listResources.bind(this.mcp),
      this.mcp.readOAuthCredentials.bind(this.mcp),
      this.mcp.performOAuth.bind(this.mcp),
      this.mcp.status.bind(this.mcp),
      this.mcp.refresh.bind(this.mcp),
      this.mcp.reload.bind(this.mcp),
      (server) => auth.mcpAuth.has(server),
      (server) => auth.mcpAuth.add(server),
      () => this.#refreshClientTools(),
      this.mcp.subscribeStatus.bind(this.mcp),
      this.mcp.findResource.bind(this.mcp),
      this.mcp.readResource.bind(this.mcp),
    );
  }
  #refreshClientTools(): Promise<void> {
    if (this.client === undefined)
      throw new Error('Foreground client is not acquired');
    return this.client.getAgentClient().setTools();
  }
  async #selectModel(model: string): Promise<void> {
    await setActiveModel(
      model,
      assembleModelSelection(this.settingsOwner),
      this.settings,
      this.manager.getActiveProvider(),
    );
  }
  #authentication(): Agent['authentication'] {
    return assembleSessionAuthentication(this.oauth, (provider) =>
      clearProviderAuthenticationCache(
        this.manager.getProviderByName(provider),
      ),
    );
  }
  #constructWorkspace(): WorkspaceControl {
    if (this.mcp === undefined)
      throw new Error('Foreground workspace is not acquired');
    return new WorkspaceControl(
      this.mcp.profileDefinitions,
      this.mcp.profileWrites,
      this.mcp.subagentDefinitions,
      this.mcp.subagentWrites,
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
    if (this.client === undefined || this.mcp === undefined)
      throw new Error('Foreground facade is not acquired');
    const runtimeState = buildFacadeState(
      parsed,
      baseUrl,
      this.config.getSessionId(),
    );
    const ownership = recordOwnership({
      runtimeHandle: { cleanup: () => this.releaseProviders() },
      injectedSchedulerHandles: handles,
      configOwnership: 'agent',
      disposeMcpRuntime: this.mcp.dispose.bind(this.mcp),
    });
    const history =
      this.client.getAgentClient().getHistoryService() ?? new HistoryService();
    this.client.getAgentClient().storeHistoryServiceForReuse(history);
    const auth = createAgentAuthState();
    return new AgentImpl(
      this.settingsOwner,
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
      this.mcp.awaitDiscovery.bind(this.mcp),
      this.mcp.closeAdmission.bind(this.mcp),
      this.#constructMcpControl(auth),
      auth,
      this.config,
      this.manager,
      this.oauth,
      () => (this.config.isInteractive() ? 'cli-interactive' : 'agent'),
      this.settings,
      this.config.getSessionId(),
      () => this.releaseProviders(),
      this.client.messageBus,
      runtimeState,
      ownership,
      'config',
      this.client.getAgentClient.bind(this.client),
      history,
      editors,
      display,
      undefined,
      parsed.auth,
      child,
      (model) => this.#selectModel(model),
      this.#authentication(),
    );
  }
}
