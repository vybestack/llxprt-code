import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { WorkspaceSkillOperations } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { ChildToolDisplay } from '../session/childToolDisplay.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import { ShellJobOwner } from '../session/shell-job-owner.js';
import type { TaskLaunchOwner } from '../session/task-launch-owner.js';

import {
  ApprovalMode,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  Agent,
  AgentInput,
  AgentMemoryControl,
  AgentMessage,
  CompressionResult,
  GenerateOptions,
  ProviderInfo,
  TurnOptions,
} from './agent.js';
import type { StableDisplayCallbacksHolder } from './agentBootstrap.js';
import { buildProviderInfos } from './agentBootstrap.js';
import {
  assembleAgentShutdown,
  collectDisposalError,
  disposeAgentObservers,
  disposeConfigInfrastructure,
  disposeOAuthManager,
  disposeWorkspaceFacades,
  finishOwnedHooks,
  joinAgentWork,
  joinCapturedRun,
} from './agentDisposeHelpers.js';
import type { AgentAuth, EditorCallbacks } from './config-types.js';
import type { AuthControl } from './control/authControl.js';
import { type AgentAuthState } from './control/authState.js';
import { type HookControl } from './control/hooks.js';
import type { IdeControl } from './control/ideControl.js';
import { LspControl } from './control/lspControl.js';
import type { McpControl } from './control/mcpControl.js';
import { PolicyControl } from './control/policyControl.js';
import type { SessionControl } from './control/sessionControl.js';
import { SkillsControl } from './control/skillsControl.js';
import type { TasksControl } from './control/tasksControl.js';
import { createTasksControl } from './control/tasksControl.js';
import type { ToolControl } from './control/toolControl.js';
import { assembleToolKeys } from './control/toolKeysControl.js';
import { assembleDirectProviderAdmission } from './directProviderAdmission.js';
import type { AgentEvent } from './event-types.js';
import { ForegroundRunLifecycle } from './foregroundRunLifecycle.js';
import type { AgentMcpOperations } from './mcpRuntimeAssembly.js';
import { createNewSessionAdmission } from './new-session-admission.js';
import { assembleProfilePersistence } from './profilePersistenceAssembly.js';
import { createRecordingExecution } from './recordingExecution.js';
import {
  idleClient,
  initializeProviderState,
  resetIdleChat,
} from './session-control-assembly.js';
import { SessionProviderOwner } from './session-provider-reads.js';
import type {
  SessionCleanupAction,
  SessionLifecycle,
} from './sessionLifecycle.js';
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
import { AgentImpl } from './agentImpl.js';
import { type AgentSchedulerHandle } from './config-types.js';
import { createAgentAuthState } from './control/authState.js';
import { assembleIdeControl } from './control/ideControl.js';

import { resolveSchedulerFactory } from '../session/assembleSchedulerOwner.js';
import { buildOwnedMcpControl } from './control/mcpControlWiring.js';
import {
  assembleSessionAuthentication,
  clearProviderAuthenticationCache,
} from './control/session-authentication.js';
import { assembleForegroundWorkspace } from './foreground-workspace-control.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import { assembleModelSelection } from './model-selection.js';
import { setActiveModel } from './providerMutations.js';
const UNCONFIGURED_AGENT_MESSAGE =
  'No provider is configured. Run /setup to choose a hosted provider, configure a local model, set up a custom compatible endpoint, or select an existing profile before using the agent.';

export abstract class ForegroundAgentAssembly extends SessionProviderOwner {
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
  async #selectModel(model: string): Promise<void> {
    await setActiveModel(
      model,
      assembleModelSelection(this.settingsOwner),
      this.foregroundSettings,
      this.foregroundManager.getActiveProvider(),
    );
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
    this.workspace = assembleForegroundWorkspace(
      this.foregroundMcp,
      this.config,
    );
    this.ide = assembleIdeControl(
      this.foregroundMcp.trust,
      this.foregroundMcp.ide,
      () => editors.editorCallbacks,
    );
    this.lsp = new LspControl(this.foregroundMcp.lspInspection);
    this.awaitMcpDiscovery = this.foregroundMcp.awaitDiscovery.bind(
      this.foregroundMcp,
    );
    this.closeMcpAdmission = this.foregroundMcp.closeAdmission.bind(
      this.foregroundMcp,
    );
    this.mcp = assembleForegroundMcpControl(
      this.foregroundMcp,
      this.ownedSessionClient.toolCatalog.selection,
      auth,
      () => this.ownedSessionClient.refreshToolDefinitions(),
    );
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
    this.selectOwnerModel = (model) => this.#selectModel(model);
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

  readonly listAvailableModels: Agent['listAvailableModels'] = (provider) =>
    this.facadeProviderManager.getAvailableModels(
      provider ?? this.getProviderStatus().provider,
    );
  protected facadeSessionOperations!: Agent['sessionClient'];
  private profilePersistence!: ReturnType<typeof assembleProfilePersistence>;
  protected captureProfile!: Agent['captureProfile'];
  protected saveProfileSnapshot!: Agent['saveProfileSnapshot'];
  protected deleteProfileByName!: Agent['deleteProfileByName'];
  protected getActiveProfileName!: Agent['getActiveProfileName'];
  protected setDefaultProfileName!: Agent['setDefaultProfileName'];
  protected getRuntimeDiagnosticsSnapshot!: Agent['getRuntimeDiagnosticsSnapshot'];
  protected tools!: ToolControl;
  protected auth!: AuthControl;
  protected session!: SessionControl;
  protected hooks!: HookControl;
  protected policy!: PolicyControl;
  protected tasks!: TasksControl;
  protected memory!: AgentMemoryControl;
  protected skills!: SkillsControl;
  private constructSessionClient(): Agent['sessionClient'] {
    return idleClient(
      this.facadeSessionOwner.operations,
      this.coordinator,
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
      this.coordinator.assertNoCommit();
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
        this.coordinator,
        this.tools,
        () => this.assertProfileIdle(),
      ),
      () => this.coordinator.closeAdmission(),
      () => this.rebuild(),
      () => this.providerState.provider,
      () => this.getModel(),
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
   * Injects a mid-turn steer message into the active agent loop. Delegates to
   * the current loop's injectSteer. No-op when no loop is running.
   */
  injectSteer(text: string): void {
    this.activeRun?.loop?.injectSteer(text);
  }

  /**
   * Streams AgentEvents by delegating to the current loop's run().
   * @plan:PLAN-20260617-COREAPI.P15
   * @requirement:REQ-003
   * @pseudocode createAgent.md steps 130-148 (loop drives the turn)
   */
  stream(input: AgentInput, opts?: TurnOptions): AsyncIterable<AgentEvent> {
    const admission = assembleDirectProviderAdmission(
      this.facadeSettingsService,
      this.facadeProviderManager,
      () => this.getModel(),
    );
    return new ForegroundRunLifecycle(
      createRecordingExecution(
        this.session,
        this.readHookSessionId,
        this.facadeSessionOwner.hookOperations,
      ),
      () => this.profiles.isApplying(),
      () => this.isProviderReady(),
      (run) => this.coordinator.admit(run),
      (run) => this.coordinator.release(run),
      () => this.facadeSessionOwner.resolveExecution(),
      () => admission.admit(),
      () => this.awaitMcpDiscovery(),
      this.tools.notifyConfirmation.bind(this.tools),
      this.tools.notifyToolUpdate.bind(this.tools),
    ).stream(input, opts);
  }

  /**
   * @plan:PLAN-20260622-COREAPIGAP.P04
   * @requirement:REQ-001
   * @pseudocode lines 1-4
   */
  getApprovalMode(): ApprovalMode {
    return this.ide.isTrustedFolder()
      ? this.config.getApprovalMode()
      : ApprovalMode.DEFAULT;
  }

  /**
   * @plan:PLAN-20260622-COREAPIGAP.P04
   * @requirement:REQ-001
   * @pseudocode lines 10-17
   */
  setApprovalMode(mode: ApprovalMode): void {
    if (!this.ide.isTrustedFolder() && mode !== ApprovalMode.DEFAULT)
      throw new Error(
        'Cannot enable privileged approval modes in an untrusted folder.',
      );
    this.config.setApprovalMode(mode);
  }

  /**
   * Resets the chat through the durable history-clear path while recording is
   * active, preserving its initial history prefix. Without recording, delegates to the
   * client's full reset contract.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  async resetChat(): Promise<void> {
    this.assertProfileIdle();
    await resetIdleChat(this.coordinator, this.session, () =>
      this.facadeSessionOwner.conversation.resetChat(),
    );
  }

  /**
   * Explicitly triggers history compression via the chat contract's
   * performCompression, mapping the fine-grained PerformCompressionResult enum
   * to the public CompressionResult.status and capturing token counts (from the
   * HistoryService) only when the history was actually compressed. The public
   * original/new token counts are guaranteed monotonic (original >= new) on the
   * 'compressed' path.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-011
   */
  async compress(opts?: {
    readonly promptId?: string;
  }): Promise<CompressionResult> {
    if (!this.isProviderReady()) throw new Error(UNCONFIGURED_AGENT_MESSAGE);
    // Ensure the chat is initialized before accessing it: setHistory can run
    // before the first turn (startChat is otherwise lazy on first turn).
    return this.facadeSessionOwner.compressHistory(
      opts?.promptId ?? `compress-${Date.now()}`,
      this.session,
      this.facadeSessionOwner.hookOperations,
    );
  }

  /**
   * Side-channel single-shot generation. Delegates to the client's detached
   * direct-message path. History reads and writes are opt-in, and generation
   * does not run a tool loop. Returns the response
   * text (empty string when the model emits no text part).
   * @plan:PLAN-20260617-COREAPI.P21
   * @requirement:REQ-012
   */
  async generate(input: AgentInput, opts?: GenerateOptions): Promise<string> {
    if (!this.isProviderReady()) throw new Error(UNCONFIGURED_AGENT_MESSAGE);
    return this.facadeSessionOwner.generateText(
      input,
      opts,
      createRecordingExecution(
        this.session,
        () => this.session.getSessionId(),
        this.facadeSessionOwner.hookOperations,
      ),
      assembleDirectProviderAdmission(
        this.facadeSettingsService,
        this.facadeProviderManager,
        this.getModel,
      ).admit(),
    );
  }

  /**
   * Side-channel structured (JSON) generation. Delegates to the client's
   * generateJson contract against a snapshot copy of the supplied contents —
   * detached from the live conversation history.
   * @plan:PLAN-20260617-COREAPI.P21
   * @requirement:REQ-012
   */
  async generateJson(
    contents: readonly AgentMessage[],
    schema: Readonly<Record<string, unknown>>,
    opts?: GenerateOptions,
  ): Promise<Record<string, unknown>> {
    if (!this.isProviderReady()) throw new Error(UNCONFIGURED_AGENT_MESSAGE);
    return this.facadeSessionOwner.generateJson(
      contents,
      schema,
      opts?.model ?? this.getModel(),
      opts?.signal,
    );
  }

  /**
   * Side-channel embedding generation. Delegates to the client's
   * generateEmbedding contract against a snapshot copy of the input texts —
   * detached from the live conversation history.
   * @plan:PLAN-20260617-COREAPI.P21
   * @requirement:REQ-012
   */
  async generateEmbedding(texts: readonly string[]): Promise<number[][]> {
    if (!this.isProviderReady()) throw new Error(UNCONFIGURED_AGENT_MESSAGE);
    return this.facadeSessionOwner.generateEmbedding(texts);
  }

  /**
   * Returns a concrete ProviderInfo[] from the runtime provider manager.
   * @plan:PLAN-20260617-COREAPI.P15
   * @requirement:REQ-017
   */
  listProviders(): readonly ProviderInfo[] {
    const names = this.facadeProviderManager.listProviders();
    return buildProviderInfos(names, new Set(names));
  }

  /**
   * Rebuilds the cached AgenticLoop bound to the CURRENT client (AgenticLoop
   * caches its constructor client and never re-resolves).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @pseudocode switch-rebind.md steps 10-26 (rebuildLoop call)
   */
  protected readonly rebuild = (): void =>
    this.facadeSessionOwner.rebuildExecution();

  /**
   * Provider readiness: true when the manager reports an active provider.
   * Used by the fail-closed guards on stream/generate/generateJson/
   * generateEmbedding/compress/setModel to prevent model-dependent operations
   * when no provider is configured.
   */

  private readonly readHookSessionId = (): string =>
    this.session.getSessionId();

  /**
   * Full ordered dispose / teardown. Idempotent; collects every teardown
   * failure into an errors[] accumulator (never short-circuiting on a single
   * failure) and throws {@link AggregateDisposeError} at the END if any step
   * failed. Tears down ONLY resources createAgent owns — caller-supplied
   * resources are left untouched. The teardown order follows the authoritative
   * pseudocode exactly:
   *   20    fire SessionEnd lifecycle hook (REQ-015)
   *   30    abort the facade-owned active-run controller
   *   40-47 dispose facade-held injected-factory scheduler/coordinator handles
   *   50-52 unsubscribe every recorded bus subscription + detach hooks
   *   55    runtimeHandle.cleanup() (unregister runtime context)
   *   60    config.dispose() (agentClient, LSP and extension teardown run
   *         inside Config.dispose)
   *   81-83 release every session lock (NET-NEW) + sessionLocksReleased
   *   90-92 oauthManager.dispose?() (defensive; runtimeHandle.cleanup may own it)
   *   100   throw AggregateDisposeError(errors) if any step failed
   *
   * @plan:PLAN-20260617-COREAPI.P24
   * @requirement:REQ-016
   * @requirement:REQ-015
   * @pseudocode dispose.md 10-14, 20, 30, 40-47, 50-52, 55, 60, 70, 80-83, 90-92, 100-102
   */
  private lifecycle?: SessionLifecycle;

  private disposeAgent(): Promise<void> {
    this.lifecycle ??= this.createShutdownLifecycle();
    return this.lifecycle.dispose();
  }

  private stopShutdownAdmissions(): readonly SessionCleanupAction[] {
    return [
      () => {
        this.facadeOwnership.disposed = true;
      },
      () => this.facadeSessionOwner.closeAdmission(),
      () => this.facadeTaskOwner.closeAdmissionAndAbort(),
      () => this.facadeSessionOwner.closeHookAdmission(),
      () => this.hooks.closeAdmission(),
      () => this.profilePersistence.closeAdmission(),
      () => this.closeMcpAdmission(),
      () => this.facadeShellOwner.closeAdmission(),
      () => this.skills.closeAdmission(),
      () => this.workspace.closeAdmission(),
      () => this.session.closeAdmission(),
      () => this.ide.closeAdmission(),
    ];
  }

  private createShutdownLifecycle(): SessionLifecycle {
    const run = this.activeRun;
    return assembleAgentShutdown(
      this.stopShutdownAdmissions(),
      [
        () => this.facadeSessionOwner.joinAuxiliaryShutdown(),
        () => this.facadeSessionOwner.closeImageAdmission(),
        () => this.facadeSessionOwner.toolCatalog.closeAdmission(),
        () => this.tools.dispose(),
      ],
      [
        () => run?.controller.abort(),
        () => this.facadeSessionOwner.abortExecution(),
      ],
      [() => this.coordinator.dispose(), () => this.facadeShellOwner.dispose()],
      (errors) =>
        joinAgentWork(
          () => this.profiles.cancelAndJoin(),
          () => this.mcp.cancelAndJoin(),
          () => this.facadeTaskOwner.hasPendingWork(),
          () => this.facadeTaskOwner.join(),
          () => this.facadeOwnership.disposeMcpRuntime?.(),
          errors,
        ),
      (errors) => joinCapturedRun(run, errors),
      () => this.profilePersistence.join(),
      async (errors) => {
        await finishOwnedHooks(
          () => this.hooks.finishSessionEnd(),
          this.releaseHooks,
          errors,
        );
        await disposeAgentObservers(
          this.facadeOwnership.injectedSchedulerHandles,
          () => this.hooks.detach(),
          () =>
            disposeWorkspaceFacades(
              () => this.skills.dispose(),
              () => this.workspace.dispose(),
            ),
          undefined,
          errors,
        );
        await collectDisposalError(errors, () => this.session.dispose());
      },
      (errors) => this.releaseShutdownResources(errors),
    );
  }

  private async releaseShutdownResources(errors: unknown[]): Promise<void> {
    await collectDisposalError(errors, () => this.facadeSessionOwner.dispose());
    await collectDisposalError(errors, this.closeRuntime);
    await disposeConfigInfrastructure(
      this.facadeOwnership.configOwnership === 'caller'
        ? undefined
        : () => this.config.dispose(),
      this.facadeMediaOwner?.dispose.bind(this.facadeMediaOwner),
      errors,
    );
    for (const lock of this.facadeOwnership.sessionLocks)
      await collectDisposalError(errors, () => lock.release());
    this.facadeOwnership.sessionLocksReleased = true;
    await collectDisposalError(errors, () =>
      disposeOAuthManager(this.facadeOAuth),
    );
  }
  protected initializeFacade(): Agent {
    this.switchProvider = this.constructProviderSwitch(this.facadeRuntimeKind);
    this.metrics = this.facadeSettingsOwner.telemetry.localMetrics;
    this.initializeProviderReads();
    this.facadeSessionOperations = this.constructSessionClient();
    this.profilePersistence = this.constructProfilePersistence();
    this.captureProfile = this.profilePersistence.captureProfile;
    this.saveProfileSnapshot = this.profilePersistence.saveProfileSnapshot;
    this.deleteProfileByName = this.profilePersistence.deleteProfileByName;
    this.getActiveProfileName = this.profilePersistence.getActiveProfileName;
    this.setDefaultProfileName = this.profilePersistence.setDefaultProfileName;
    this.getRuntimeDiagnosticsSnapshot =
      this.profilePersistence.getRuntimeDiagnosticsSnapshot;
    this.providerState = initializeProviderState(
      this.facadeRuntimeState,
      this.initialAuth,
      this.facadeAuthState,
    );
    this.tools = this.constructTools();
    this.profiles = this.constructProfiles();
    this.auth = this.buildAuthControl();
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
  private publishFacade(): Agent {
    return new AgentImpl(
      this.facadeSessionOwner.createProviderFileOperations(() =>
        this.coordinator.assertSettingsAdmission(),
      ),
      {
        workspace: this.workspace,
        ide: this.ide,
        lsp: this.lsp,
        mcp: this.mcp,
        runtimeId: this.facadeRuntimeId,
        authentication: this.authentication,
        execution: this.execution,
        modelParameters: this.modelParameters,
        settings: this.settings,
        conversation: this.facadeSessionOwner.conversation,
        getStats: () => this.facadeSessionOwner.readStats(this.metrics),
        onStats: (cb) => this.facadeSessionOwner.observeStats(cb, this.metrics),
        toolFormat: this.toolFormat,
        metrics: this.metrics,
        providerReads: this.providerReads,
        hasActiveProvider: this.hasActiveProvider,
        getProviderContextLimit: this.getProviderContextLimit,
        listAvailableModels: this.listAvailableModels,
        sessionClient: this.facadeSessionOperations,
        captureProfile: this.captureProfile,
        saveProfileSnapshot: this.saveProfileSnapshot,
        deleteProfileByName: this.deleteProfileByName,
        getActiveProfileName: this.getActiveProfileName,
        setDefaultProfileName: this.setDefaultProfileName,
        getRuntimeDiagnosticsSnapshot: this.getRuntimeDiagnosticsSnapshot,
        tools: this.tools,
        profiles: this.profiles,
        auth: this.auth,
        session: this.session,
        hooks: this.hooks,
        policy: this.policy,
        tasks: this.tasks,
        memory: this.memory,
        skills: this.skills,
        injectSteer: this.injectSteer.bind(this),
        stream: this.stream.bind(this),
        getProvider: this.getProvider,
        setProvider: this.setProvider.bind(this),
        getProviderStatus: this.getProviderStatus,
        getModel: this.getModel,
        setModel: this.setModel.bind(this),
        getApprovalMode: this.getApprovalMode.bind(this),
        setApprovalMode: this.setApprovalMode.bind(this),
        getModelParams: this.getModelParams,
        resetChat: this.resetChat.bind(this),
        compress: this.compress.bind(this),
        generate: this.generate.bind(this),
        generateJson: this.generateJson.bind(this),
        generateEmbedding: this.generateEmbedding.bind(this),
        listProviders: this.listProviders.bind(this),
        dispose: this.disposeAgent.bind(this),
      },
    );
  }
}

export function assembleForegroundMcpControl(
  workspace: McpRuntimeOwner,
  selection: Parameters<typeof buildOwnedMcpControl>[1],
  auth: AgentAuthState,
  refreshTools: () => Promise<void>,
): McpControl {
  return buildOwnedMcpControl(
    workspace.readServerSettings.bind(workspace),
    selection,
    workspace.listPrompts.bind(workspace),
    workspace.listResources.bind(workspace),
    workspace.readOAuthCredentials.bind(workspace),
    workspace.performOAuth.bind(workspace),
    workspace.status.bind(workspace),
    workspace.refresh.bind(workspace),
    workspace.reload.bind(workspace),
    (server) => auth.mcpAuth.has(server),
    (server) => auth.mcpAuth.add(server),
    refreshTools,
    workspace.subscribeStatus.bind(workspace),
    workspace.findResource.bind(workspace),
    workspace.readResource.bind(workspace),
  );
}
