import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { WorkspaceSkillOperations } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { ChildToolDisplay } from '../session/childToolDisplay.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import { ShellJobOwner } from '../session/shell-job-owner.js';
import type { TaskLaunchOwner } from '../session/task-launch-owner.js';

import {
  type Config,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { WorkspaceControl } from './control/workspaceControl.js';
import type { Agent, AgentMemoryControl } from './agent.js';
import type {
  OwnershipRecord,
  StableDisplayCallbacksHolder,
} from './agentBootstrap.js';
import type { AgentAuth, EditorCallbacks } from './config-types.js';
import { type AgentAuthState } from './control/authState.js';
import { type HookControl } from './control/hooks.js';
import type { IdeControl } from './control/ideControl.js';
import type { LspControl } from './control/lspControl.js';
import type { McpControl } from './control/mcpControl.js';
import { PolicyControl } from './control/policyControl.js';
import type { SessionControl } from './control/sessionControl.js';
import { SkillsControl } from './control/skillsControl.js';
import type { TasksControl } from './control/tasksControl.js';
import { createTasksControl } from './control/tasksControl.js';
import type { ToolControl } from './control/toolControl.js';
import { assembleToolKeys } from './control/toolKeysControl.js';
import type { AgentMcpOperations } from './mcpRuntimeAssembly.js';
import { createNewSessionAdmission } from './new-session-admission.js';
import { assembleProfilePersistence } from './profilePersistenceAssembly.js';
import { idleClient } from './session-control-assembly.js';
import {
  createSessionProviderControl,
  type SessionProviderControl,
} from './session-provider-reads.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type WorkspaceDefinitionOwner,
  type WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';
import { resolveShellJobSettings } from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';

import { type WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { type WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';

import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';

import { admittedEndpoint } from '../core/admittedRouteSecurity.js';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
import { type SchedulerConstruction } from '../session/assembleSchedulerOwner.js';
import { withChildToolDisplay } from '../session/childToolAssembly.js';

import {
  assembleTaskOwner,
  cleanupFailedShellBootstrap,
} from './agent-shell-assembly.js';

import {
  buildFacadeState,
  createStableDisplayCallbacks,
  recordOwnership,
  type StableEditorCallbacksHolder,
} from './agentBootstrap.js';
import {
  AgentOperations,
  createAgentApprovalOwner,
  createAgentDisposalOwners,
  createAgentTurnOwners,
} from './agent-operations.js';
import { AgentImpl } from './agentImpl.js';
import { type AgentSchedulerHandle } from './config-types.js';
import { createAgentAuthState } from './control/authState.js';

import { resolveSchedulerFactory } from '../session/assembleSchedulerOwner.js';
import {
  assembleSessionAuthentication,
  clearProviderAuthenticationCache,
} from './control/session-authentication.js';
import { assembleWorkspaceFacade } from './agent-facade.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';

export abstract class ForegroundAgentAssembly {
  protected workspace!: WorkspaceControl;
  protected providerControl!: SessionProviderControl;
  protected facadeSettingsOwner!: SessionSettingsOwner;
  protected facadeSessionOwner!: SessionClientOwner;
  protected facadeAuthState!: AgentAuthState;
  protected config!: Config;
  protected facadeProviderManager!: RuntimeProviderManager;
  protected facadeOAuth!: OAuthManager;
  protected facadeSettingsService!: SettingsService;
  protected facadeRuntimeState!: AgentRuntimeState;
  protected facadeOwnership!: OwnershipRecord;
  protected onOAuthPrompt!: unknown | undefined;
  protected initialAuth!: AgentAuth | undefined;
  readonly #constructionCancellation = new AbortController();

  protected closeConstructionAdmission(): void {
    this.#constructionCancellation.abort();
  }
  protected mediaOwner: SessionMediaOwner | undefined;
  protected ownsSessionClient = true;
  protected ownsSettings = true;
  protected ownsMemory = false;
  protected providerFileLifecycle!: ProviderFileLifecycle | undefined;
  protected ownedSessionClient!: SessionClientOwner;
  protected workspaceFilesystem!: WorkspaceFilesystemOwner;
  protected workspaceMemory!: WorkspaceMemoryOwner;
  protected ownsFilesystem!: boolean;
  protected settingsOwner!: SessionSettingsOwner;
  protected settingsOwnerOwnership!: 'borrowed' | 'transferred';
  protected workspaceDefinitions!: WorkspaceDefinitionOwner;
  protected ownsDefinitions!: boolean;
  protected workspaceTrust!: WorkspaceTrustControlPort;
  protected trustCleanup!: (() => Promise<void>) | undefined;
  protected oauthManager!: OAuthManager | undefined;
  protected messageBus!: MessageBus | undefined;
  protected workspaceMemoryOwnership!: 'borrowed' | 'transferred';
  protected foregroundMcp: McpRuntimeOwner | undefined;
  protected foregroundSettings!: SettingsService;
  protected foregroundManager!: RuntimeProviderManager;
  protected foregroundOAuth!: OAuthManager;
  protected releaseForegroundProviders!: () => Promise<void>;
  protected assertConstructionOpen(): void {
    this.#constructionCancellation.signal.throwIfAborted();
  }
  protected async finishForeground(): Promise<Agent> {
    const handles: AgentSchedulerHandle[] = [];
    const provider =
      this.foregroundManager.getActiveProviderName() ??
      this.config.getProvider() ??
      '';
    const model =
      this.settingsOwner.readSelectedModel() ?? this.config.getModel();
    await this.ownedSessionClient.tokenizerFactory.prepareTokenizer?.(
      provider,
      model,
    );
    this.assertConstructionOpen();
    return this.#acquireFacade(
      { provider, model },
      admittedEndpoint(this.foregroundSettings, provider),
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
    const tasks = assembleTaskOwner(this.foregroundSettings, undefined);
    const shell = new ShellJobOwner(() =>
      resolveShellJobSettings(this.foregroundSettings),
    );
    const child = new ChildToolDisplay();
    const display: StableDisplayCallbacksHolder = {};
    try {
      const editors = { editorCallbacks: {} };
      this.ownedSessionClient.toolCatalog.bindChildExecution(
        child,
        tasks,
        shell,
      );
      this.ownedSessionClient.initializeExecution(
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
  #authentication(): Agent['authentication'] {
    return assembleSessionAuthentication(this.foregroundOAuth, (provider) =>
      clearProviderAuthenticationCache(
        this.foregroundManager.getProviderByName(provider),
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
    if (this.foregroundMcp === undefined)
      throw new Error('Foreground facade is not acquired');
    const runtimeState = buildFacadeState(
      parsed,
      baseUrl,
      this.config.getSessionId(),
    );
    const ownership = recordOwnership({
      runtimeHandle: { cleanup: () => this.releaseForegroundProviders() },
      injectedSchedulerHandles: handles,
      configOwnership: 'agent',
      disposeMcpRuntime: this.foregroundMcp.dispose.bind(this.foregroundMcp),
    });
    this.ownedSessionClient.initializeConversation();
    const auth = createAgentAuthState();
    this.facadeSettingsOwner = this.settingsOwner;
    this.facadeSessionOwner = this.ownedSessionClient;
    this.facadeWorkspaceSkills = this.foregroundMcp.workspaceSkills.operations;
    this.facadeMediaOwner = this.mediaOwner;
    this.facadeTaskOwner = tasks;
    this.facadeShellOwner = shell;
    const controls = assembleWorkspaceFacade(
      this.foregroundMcp,
      this.config,
      this.ownedSessionClient,
      auth,
      editors,
    );
    this.workspace = controls.workspace;
    this.ide = controls.ide;
    this.lsp = controls.lsp;
    this.awaitMcpDiscovery = this.foregroundMcp.awaitDiscovery.bind(
      this.foregroundMcp,
    );
    this.closeMcpAdmission = this.foregroundMcp.closeAdmission.bind(
      this.foregroundMcp,
    );
    this.mcp = controls.mcp;
    this.facadeAuthState = auth;
    this.facadeProviderManager = this.foregroundManager;
    this.facadeOAuth = this.foregroundOAuth;
    this.facadeRuntimeKind = () =>
      this.config.isInteractive() ? 'cli-interactive' : 'agent';
    this.facadeSettingsService = this.foregroundSettings;
    this.facadeRuntimeId = this.config.getSessionId();
    this.closeRuntime = () => this.releaseForegroundProviders();

    this.facadeRuntimeState = runtimeState;
    this.facadeOwnership = ownership;
    this.sessionIdentityOwnership = 'config';

    this.facadeEditors = editors;
    this.facadeDisplay = display;
    this.onOAuthPrompt = undefined;
    this.initialAuth = parsed.auth;
    this.childDisplay = child;
    this.authentication = this.#authentication();
    return this.initializeFacade();
  }
  protected facadeWorkspaceSkills!: WorkspaceSkillOperations;
  protected facadeMediaOwner!: SessionMediaOwner | undefined;
  protected facadeTaskOwner!: TaskLaunchOwner;
  protected facadeShellOwner!: ShellJobOwner;
  protected ide!: IdeControl;
  protected lsp!: LspControl;
  protected awaitMcpDiscovery!: AgentMcpOperations['awaitDiscovery'];
  protected closeMcpAdmission!: () => void;
  protected mcp!: McpControl;
  protected facadeRuntimeKind!: () => RuntimeKind;
  protected facadeRuntimeId!: string;
  protected closeRuntime!: () => Promise<void> | void;
  protected sessionIdentityOwnership!: 'config' | 'facade';

  protected facadeEditors!: {
    editorCallbacks: EditorCallbacks;
  };
  protected facadeDisplay!: StableDisplayCallbacksHolder;
  protected childDisplay!: ChildToolDisplay | undefined;
  protected authentication!: Agent['authentication'];

  protected metrics!: Agent['metrics'];

  protected facadeSessionOperations!: Agent['sessionClient'];
  private profilePersistence!: ReturnType<typeof assembleProfilePersistence>;
  protected captureProfile!: Agent['captureProfile'];
  protected saveProfileSnapshot!: Agent['saveProfileSnapshot'];
  protected deleteProfileByName!: Agent['deleteProfileByName'];
  protected getActiveProfileName!: Agent['getActiveProfileName'];
  protected setDefaultProfileName!: Agent['setDefaultProfileName'];
  protected getRuntimeDiagnosticsSnapshot!: Agent['getRuntimeDiagnosticsSnapshot'];
  protected tools!: ToolControl;
  protected session!: SessionControl;
  protected hooks!: HookControl;
  protected policy!: PolicyControl;
  protected tasks!: TasksControl;
  protected memory!: AgentMemoryControl;
  protected skills!: SkillsControl;
  private constructSessionClient(): Agent['sessionClient'] {
    return idleClient(
      this.facadeSessionOwner.operations,
      this.providerControl.coordinator,
      () => this.rebuild(),
    );
  }
  private constructProfilePersistence(): ReturnType<
    typeof assembleProfilePersistence
  > {
    return assembleProfilePersistence(
      () => this.config.getModel(),
      () => this.config.getProvider(),
      this.facadeSettingsService,
      this.facadeProviderManager,
      () => this.facadeSettingsOwner.captureNamedParameters(),
      this.workspace.profileWrites,
    );
  }
  private constructTools(): ToolControl {
    const assertSessionAdmission = (): void =>
      this.providerControl.coordinator.assertNoCommit();
    this.facadeTaskOwner.bindSessionAdmission(assertSessionAdmission);
    this.facadeShellOwner.bindSessionAdmission(assertSessionAdmission);
    return this.facadeSessionOwner.createToolControl(
      assertSessionAdmission,
      this.childDisplay,
      this.facadeEditors,
      this.facadeDisplay,
      assembleToolKeys(),
    );
  }

  private buildSessionControl(): SessionControl {
    return this.facadeSessionOwner.createSessionControl(
      this.sessionIdentityOwnership,
      () => this.facadeRuntimeId,
      createNewSessionAdmission(
        this.facadeTaskOwner,
        this.facadeShellOwner,
        this.providerControl.coordinator,
        this.tools,
        () => this.providerControl.assertProfileIdle(),
      ),
      () => this.providerControl.coordinator.closeAdmission(),
      () => this.rebuild(),
      () => this.providerControl.getProvider(),
      () => this.providerControl.getModel(),
    );
  }

  /**
   * Builds the HookControl wired to the live Config (HookSystem + enable flag)
   * and the SHARED MessageBus, so onHookExecution observes bus-mediated hook
   * executions and triggerSessionStart/triggerSessionEnd fire the real
   * lifecycle hooks.
   * @plan:PLAN-20260617-COREAPI.P23
   * @requirement:REQ-015
   */
  private releaseHooks!: () => Promise<void>;

  private buildHookControl(): HookControl {
    return this.facadeSessionOwner.createHookControl(this.session);
  }

  /**
   * Builds the McpControl wired to read the per-agent mcpAuth set plus the
   * Core-owned MCP runtime capabilities (runtime-status snapshot, refresh,
   * reload) and tool registry so listServers/status/toolsByServer/
   * discoveryState/refresh project the REAL discovery surface without
   * agents reaching the concrete manager.
   * @plan:PLAN-20260617-COREAPI.P22
   * @requirement:REQ-013
   * @requirement:REQ-019
   */

  /**
   * Awaits MCP discovery readiness before a model turn (the discovery gate).
   * The wait is bounded by the manager so a never-settling server cannot hang
   * the turn. Per-server discovery failures are NON-FATAL: the turn proceeds
   * with whatever tools are available and each failed server is surfaced as a
   * warning notice (issue #2516). `mcpDiscovery:'skip'` opts out (returns no
   * failures without awaiting). Non-blocking methods (mcp.status/discoveryState,
   * listTools) remain callable throughout.
   *
   * @plan:PLAN-20260617-COREAPI.P22
   * @requirement:REQ-013
   * @requirement:REQ-019
   */

  /**
   * Rebuilds the cached AgenticLoop bound to the CURRENT client (AgenticLoop
   * caches its constructor client and never re-resolves).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @pseudocode switch-rebind.md steps 10-26 (rebuildLoop call)
   */
  protected readonly rebuild = (): void =>
    this.facadeSessionOwner.rebuildExecution();

  protected initializeFacade(): Agent {
    this.providerControl = createSessionProviderControl(
      {
        settingsOwner: this.facadeSettingsOwner,
        settingsService: this.facadeSettingsService,
      },
      this.facadeProviderManager,
      this.facadeOAuth,
      this.facadeSessionOwner,
      {
        config: this.config,
        authState: this.facadeAuthState,
        ownership: this.facadeOwnership,
        runtimeState: this.facadeRuntimeState,
        initialAuth: this.initialAuth,
        onOAuthPrompt: this.onOAuthPrompt,
        workspace: this.workspace,
        readRuntimeKind: this.facadeRuntimeKind,
      },
    );
    this.metrics = this.facadeSettingsOwner.telemetry.localMetrics;
    this.facadeSessionOperations = this.constructSessionClient();
    this.profilePersistence = this.constructProfilePersistence();
    this.captureProfile = this.profilePersistence.captureProfile;
    this.saveProfileSnapshot = this.profilePersistence.saveProfileSnapshot;
    this.deleteProfileByName = this.profilePersistence.deleteProfileByName;
    this.getActiveProfileName = this.profilePersistence.getActiveProfileName;
    this.setDefaultProfileName = this.profilePersistence.setDefaultProfileName;
    this.getRuntimeDiagnosticsSnapshot =
      this.profilePersistence.getRuntimeDiagnosticsSnapshot;
    this.tools = this.constructTools();
    this.session = this.buildSessionControl();
    this.hooks = this.buildHookControl();
    this.policy = new PolicyControl(this.facadeSessionOwner.policyInspection);
    this.tasks = createTasksControl(
      this.facadeTaskOwner,
      this.facadeShellOwner,
    );
    this.skills = new SkillsControl(this.facadeWorkspaceSkills);
    this.memory = this.facadeSessionOwner.memoryOperations;
    this.releaseHooks = this.facadeSessionOwner.transferHookRelease();
    return this.publishFacade();
  }
  private constructOperations(): AgentOperations {
    return new AgentOperations(
      createAgentTurnOwners(
        this.facadeSessionOwner,
        this.providerControl,
        this.session,
        this.tools,
        this.facadeSettingsService,
        this.facadeProviderManager,
        this.awaitMcpDiscovery,
      ),
      createAgentApprovalOwner(this.ide, this.config),
      createAgentDisposalOwners(
        {
          ownership: this.facadeOwnership,
          session: this.facadeSessionOwner,
          coordinator: this.providerControl.coordinator,
          tasks: this.facadeTaskOwner,
          shell: this.facadeShellOwner,
          hooks: this.hooks,
          releaseHooks: this.releaseHooks,
          profilePersistence: this.profilePersistence,
          closeMcpAdmission: this.closeMcpAdmission,
          skills: this.skills,
          workspace: this.workspace,
          sessionControl: this.session,
          ide: this.ide,
          tools: this.tools,
          profiles: this.providerControl.profiles,
          mcp: this.mcp,
          closeRuntime: this.closeRuntime,
          media: this.facadeMediaOwner,
        },
        this.config,
        this.facadeOAuth,
      ),
    );
  }
  private publishFacade(): Agent {
    const operations = this.constructOperations();
    return new AgentImpl(
      this.facadeSessionOwner.createProviderFileOperations(() =>
        this.providerControl.coordinator.assertSettingsAdmission(),
      ),
      {
        workspace: this.workspace,
        ide: this.ide,
        lsp: this.lsp,
        mcp: this.mcp,
        runtimeId: this.facadeRuntimeId,
        authentication: this.authentication,
        execution: this.providerControl.execution,
        modelParameters: this.providerControl.modelParameters,
        settings: this.providerControl.settings,
        conversation: this.facadeSessionOwner.conversation,
        getStats: () => this.facadeSessionOwner.readStats(this.metrics),
        onStats: (cb) => this.facadeSessionOwner.observeStats(cb, this.metrics),
        toolFormat: this.providerControl.toolFormat,
        metrics: this.metrics,
        providerReads: this.providerControl.providerReads,
        hasActiveProvider: this.providerControl.hasActiveProvider,
        getProviderContextLimit: this.providerControl.getProviderContextLimit,
        listAvailableModels: this.providerControl.listAvailableModels,
        sessionClient: this.facadeSessionOperations,
        captureProfile: this.captureProfile,
        saveProfileSnapshot: this.saveProfileSnapshot,
        deleteProfileByName: this.deleteProfileByName,
        getActiveProfileName: this.getActiveProfileName,
        setDefaultProfileName: this.setDefaultProfileName,
        getRuntimeDiagnosticsSnapshot: this.getRuntimeDiagnosticsSnapshot,
        tools: this.tools,
        profiles: this.providerControl.profiles,
        auth: this.providerControl.auth,
        session: this.session,
        hooks: this.hooks,
        policy: this.policy,
        tasks: this.tasks,
        memory: this.memory,
        skills: this.skills,
        injectSteer: operations.injectSteer.bind(operations),
        stream: operations.stream.bind(operations),
        getProvider: this.providerControl.getProvider,
        setProvider: this.providerControl.setProvider,
        getProviderStatus: this.providerControl.getProviderStatus,
        getModel: this.providerControl.getModel,
        setModel: this.providerControl.setModel,
        getApprovalMode: operations.getApprovalMode.bind(operations),
        setApprovalMode: operations.setApprovalMode.bind(operations),
        getModelParams: this.providerControl.getModelParams,
        resetChat: operations.resetChat.bind(operations),
        compress: operations.compress.bind(operations),
        generate: operations.generate.bind(operations),
        generateJson: operations.generateJson.bind(operations),
        generateEmbedding: operations.generateEmbedding.bind(operations),
        listProviders: this.providerControl.listProviders,
        dispose: operations.dispose.bind(operations),
      },
    );
  }
}
