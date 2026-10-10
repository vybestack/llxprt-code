/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P15
 * @requirement:REQ-001
 * @requirement:REQ-003
 * @requirement:REQ-017
 */

import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';

import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { generateDetachedText } from './detached-generation.js';
import { executeHookCompression } from './compression-execution.js';
import {
  ApprovalMode,
  type HistoryClearOptions,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
// @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
// @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
import { assembleAgentTools } from './agent-tool-assembly.js';

import {
  updateActiveProviderApiKey,
  updateActiveProviderBaseUrl,
} from '@vybestack/llxprt-code-providers/runtime/providerMutations.js';
import {
  setActiveModelParam,
  clearActiveModelParam,
} from '@vybestack/llxprt-code-providers/runtime/providerModelParameters.js';
import {
  setAgentSelectedModel,
  restoreAgentChatVisibility,
  assembleProfilePersistence,
  buildProfileProviderStatus,
  snapshotModelParams,
} from './profilePersistenceAssembly.js';

import type { ActiveRun } from './directProviderAdmission.js';
import { assembleForegroundRun } from './foreground-run-assembly.js';
import { streamForegroundRun } from './foregroundRunLifecycle.js';
import { AgentExecutionCoordinator } from './agentExecutionCoordinator.js';
import type {
  AgentHistoryItem,
  AgentInput,
  AgentMessage,
  AgentResult,
  AuthStatus,
  CompressionResult,
  GenerateOptions,
  ProviderInfo,
  ProviderStatus,
  SessionStats,
  ToolInfo,
  TurnOptions,
  Unsubscribe,
  Agent,
  AgentMemoryControl,
  AgentSkillsControl,
  AgentWorkspaceControl,
  AgentLspControl,
  AgentProviderSwitchOptions,
  AgentProviderSwitchResult,
} from './agent.js';
import type { AgentEvent } from './event-types.js';
import type { ToolControl } from './control/toolControl.js';
import type { McpControl } from './control/mcpControl.js';
// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
import { buildOwnedMcpControl } from './control/mcpControlWiring.js';

import { AuthControl, isOAuthPromptHandler } from './control/authControl.js';
import { IdeControl } from './control/ideControl.js';
import { type HookControl, createAgentHookControl } from './control/hooks.js';
import { PolicyControl } from './control/policyControl.js';
import { createTasksControl } from './control/tasksControl.js';
import type { TasksControl } from './control/tasksControl.js';
import { SessionControl } from './control/sessionControl.js';
import { AgentSessionPersistence } from './control/recordedHistoryPersistence.js';
import type { SessionControlDeps } from './control/sessionControl.js';
import {
  createRecordingExecution,
  currentRecordingPath,
} from './recordingExecution.js';
import { assembleAgentProfiles } from './profileApplicationAssembly.js';
import { assembleProviderReads } from './provider-read-assembly.js';
import { assembleProfileReplacement } from './profileReplacement.js';
import { buildNewControls, type NewControls } from './control/newControls.js';

import { AgentBusyError } from './loop/agentBusyError.js';

import { UNCONFIGURED_PROVIDER } from './constants.js';

/**
 * Actionable error message used when the Agent is unconfigured — no active
 * provider is set on the manager. Every model-dependent path must fail
 * closed with this message so the user is guided to /setup.
 */
const UNCONFIGURED_AGENT_MESSAGE =
  'No provider is configured. Run /setup to choose a hosted provider, configure a local model, set up a custom compatible endpoint, or select an existing profile before using the agent.';
import {
  drainToResult,
  buildAgentResult,
  buildProviderInfos,
  buildToolInfosFromRegistry,
  type OwnershipRecord,
} from './agentBootstrap.js';
import type { EditorCallbacks } from './config-types.js';
import { createAgentAuthState } from './control/authState.js';
import type { AgentAuthState, AuthWinner } from './control/authState.js';
import { computeAuthWinner } from './control/authState.js';
import type { AgentSchedulerHandle } from './config-types.js';
import { toRuntimeSwitchOptions } from './providerSwitchOptionsAdapter.js';
import {
  projectSessionStats,
  projectCurrentSequenceModel,
  subscribeSessionStats,
} from './agentStatsProjector.js';
import {
  releaseAgentFinalResources,
  disposeAgentObservers,
  disposeConfigInfrastructure,
  joinAgentWork,
  joinCapturedRun,
  collectDisposalError,
  finishOwnedHooks,
} from './agentDisposeHelpers.js';

import { AggregateDisposeError } from './disposeErrors.js';
import {
  SessionLifecycle,
  type SessionCleanupAction,
} from './sessionLifecycle.js';

import type { AgentDeps } from './agent-deps.js';
export type { AgentDeps } from './agent-deps.js';

/**
 * Mutable per-agent provider/model/param state holder.
 *
 * AgentRuntimeState is fully readonly, and the global runtime accessors return
 * 'fake' under the LLXPRT_FAKE_RESPONSES seam even after a switch. getProvider/
 * getModel/getModelParams/getProviderStatus therefore read THIS holder so they
 * reflect the per-agent switch (T4 asserts getProvider()==='openai').
 *
 * @plan:PLAN-20260617-COREAPI.P16
 * @requirement:REQ-004
 */
export interface AgentProviderState {
  provider: string;
  model: string;
  modelParams: Record<string, unknown>;
  baseUrl?: string;
  keyName?: string;
  isLoadBalancer?: boolean;
}

/**
 * AgentImpl — the concrete Agent built by createAgent via buildAgent.
 * @plan:PLAN-20260617-COREAPI.P15
 * @requirement:REQ-001
 * @requirement:REQ-003
 */
export class AgentImpl implements Agent {
  private readonly coordinator = new AgentExecutionCoordinator();
  readonly execution: Agent['execution'] = this.coordinator;
  private get activeRun(): ActiveRun | undefined {
    return this.coordinator.current();
  }
  readonly profiles: ReturnType<typeof assembleAgentProfiles>;
  readonly tools: ToolControl;
  readonly mcp: McpControl;
  readonly auth: AuthControl;
  readonly ide: IdeControl;
  readonly session: SessionControl;
  readonly hooks: HookControl;
  readonly policy: PolicyControl;
  /** @plan:PLAN-20260622-COREAPIGAP.P08 @requirement:REQ-003 */
  readonly tasks: TasksControl;
  readonly memory: AgentMemoryControl;
  readonly skills: AgentSkillsControl;
  readonly workspace: AgentWorkspaceControl;
  readonly lsp: AgentLspControl;
  private readonly newControls: NewControls;

  /** @pseudocode createAgent.md steps 150-160 */
  readonly ownership: OwnershipRecord;

  /**
   * The runtime ProviderManager the facade governs. Exposed (mirroring
   * messageBus/agentClient) so identity probes can assert the adopted manager
   * is the SAME instance the caller supplied (CRIT-1: no second manager).
   * @plan:PLAN-20260621-COREAPIREMED.P09
   * @requirement:REQ-001
   */
  readonly providerManager: RuntimeProviderManager;

  /**
   * The runtimeId the facade was built with. Exposed (mirroring
   * messageBus/agentClient) so identity probes can assert the deterministic
   * sessionId-derived runtime id.
   * @plan:PLAN-20260621-COREAPIREMED.P09
   * @requirement:REQ-001
   */
  readonly runtimeId: string;

  /**
   * The single shared MessageBus createAgent threaded through every surface.
   * Exposed so the T13 disposal probe can read the private emitter's listener
   * tally and assert it reaches zero after dispose() unsubscribes every recorded
   * subscription (dispose.md lines 50-52). This is the SAME bus instance — no
   * second bus is ever created.
   * @plan:PLAN-20260617-COREAPI.P24
   * @requirement:REQ-016
   */
  readonly messageBus: MessageBus;

  /**
   * The Config-owned AgentClient (the eager post-auth client refreshAuth
   * created). Captured at construction so the T13 disposal probe observes its
   * `handleModelChanged` handler leaving the coreEvents emitter after
   * config.dispose() disposes it (dispose.md line 60). The SAME instance
   * dispose() tears down.
   * @plan:PLAN-20260617-COREAPI.P24
   * @requirement:REQ-016
   */
  readonly sessionClient: Agent['sessionClient'];

  get agentClient(): AgentClientContract {
    return this.deps.sessionClient.getAgentClient();
  }

  /**
   * Per-agent mutable provider/model/param state. Initialized from the
   * (readonly) AgentRuntimeState; updated by setProvider/setModel/setModelParam
   * and profiles.apply. Read by getProvider/getModel/getModelParams/
   * getProviderStatus so they reflect per-agent switches (the global runtime
   * accessors return 'fake' under the LLXPRT_FAKE_RESPONSES seam).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   */
  private readonly providerState: AgentProviderState;

  /**
   * Per-agent mutable auth state (parallel to providerState). Carries every
   * auth-related field the public auth/keys controls mutate and that
   * computeAuthStatus/getProviderStatus read, EXCEPT the keyName reference
   * (which lives on providerState.keyName as the single source of truth). The
   * secret value lives ONLY in authState.keyStore and is NEVER surfaced.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  private readonly authState: AgentAuthState = createAgentAuthState();

  /** Mutable editor-callbacks holder shared with ToolControl + forwarding object. */
  private readonly editorCallbacksHolder: { editorCallbacks: EditorCallbacks };

  /** Mutable display-callbacks holder shared with ToolControl + stable forwarding object. */

  private readonly profilePersistence: ReturnType<
    typeof assembleProfilePersistence
  >;
  readonly captureProfile: Agent['captureProfile'];
  readonly saveProfileSnapshot: Agent['saveProfileSnapshot'];
  readonly deleteProfileByName: Agent['deleteProfileByName'];
  readonly getActiveProfileName: Agent['getActiveProfileName'];
  readonly setDefaultProfileName: Agent['setDefaultProfileName'];
  readonly getRuntimeDiagnosticsSnapshot: Agent['getRuntimeDiagnosticsSnapshot'];

  readonly hasActiveProvider: Agent['hasActiveProvider'];
  readonly getProviderContextLimit: Agent['getProviderContextLimit'];
  readonly listAvailableModels: Agent['listAvailableModels'];

  constructor(private readonly deps: AgentDeps) {
    this.sessionClient = deps.sessionClient.operations;
    const reads = assembleProviderReads(
      deps.providerManager,
      () => this.getProviderStatus().provider,
    );
    this.hasActiveProvider = reads.hasActiveProvider;
    this.getProviderContextLimit = reads.getProviderContextLimit;
    this.listAvailableModels = reads.listAvailableModels;
    this.profilePersistence = assembleProfilePersistence(
      deps.config,
      deps.settingsService,
      deps.providerManager,
      () => deps.settingsOwner.captureNamedParameters(),
      deps.mcpOperations.profileWrites,
    );
    this.captureProfile = this.profilePersistence.captureProfile;
    this.saveProfileSnapshot = this.profilePersistence.saveProfileSnapshot;
    this.deleteProfileByName = this.profilePersistence.deleteProfileByName;
    this.getActiveProfileName = this.profilePersistence.getActiveProfileName;
    this.setDefaultProfileName = this.profilePersistence.setDefaultProfileName;
    this.getRuntimeDiagnosticsSnapshot =
      this.profilePersistence.getRuntimeDiagnosticsSnapshot;
    this.ownership = deps.ownership;
    this.providerManager = deps.providerManager;
    this.runtimeId = deps.runtimeId;
    // @plan:PLAN-20260617-COREAPI.P24 @requirement:REQ-016
    // Expose the SAME shared MessageBus + Config-owned AgentClient + injected
    // scheduler/coordinator the facade owns so the T13 disposal probe reads the
    // genuine live objects dispose() tears down (no second bus, no clones).
    this.messageBus = deps.messageBus;

    const rs = deps.runtimeState;
    this.providerState = {
      provider: rs.provider,
      model: rs.model,
      modelParams: Object.assign(
        Object.create(null) as Record<string, unknown>,
        rs.modelParams ?? {},
      ),
      baseUrl: rs.baseUrl,
    };
    // @plan:PLAN-20260617-COREAPI.P18 @requirement:REQ-008
    this.seedAuthState(rs.provider);
    // Shared mutable holders threaded from finalizeAgent.
    this.editorCallbacksHolder = deps.editorCallbacksHolder;
    this.tools = assembleAgentTools(deps);
    this.profiles = assembleAgentProfiles(
      deps.config,
      deps.settingsService,
      deps.providerManager,
      deps.oauthManager,
      deps.switchProvider,
      deps.settingsOwner,
      this.providerState,
      this.authState,
      this.captureProfile,
      (changed, signal) => this.prepareReplacement(changed, signal),
      deps.mcpOperations.profileDefinitions,
    );
    this.auth = this.buildAuthControl();
    this.mcp = this.buildMcpControl();
    this.ide = new IdeControl({
      trust: deps.mcpOperations.trust,
      ide: deps.mcpOperations.ide,
      ideModeEnabled: () => deps.mcpOperations.ide.isEnabled(),
      getEditorCallbacks: () => this.editorCallbacksHolder.editorCallbacks,
    });
    this.session = this.buildSessionControl();
    this.hooks = this.buildHookControl();
    this.policy = new PolicyControl({
      inspection: deps.sessionClient.policyInspection,
    });
    this.tasks = createTasksControl(deps.taskLaunchOwner, deps.shellOwner);
    this.newControls = buildNewControls(
      deps.config,
      deps.workspaceSkills,
      deps.mcpOperations,
    );
    this.memory = deps.sessionClient.memoryOperations;
    this.skills = this.newControls.skills;
    this.workspace = this.newControls.workspace;
    this.lsp = this.newControls.lsp;
  }

  private readonly prepareReplacement = (
    changed: boolean,
    signal: AbortSignal,
  ) =>
    assembleProfileReplacement(
      {
        telemetry: this.deps.settingsOwner.telemetry,
        loopHolder: this.deps.loopHolder,
        toolSelection: this.deps.sessionClient.toolCatalog.selection,
        readApprovalMode: () => this.getApprovalMode(),
        readExecutionPolicy: () =>
          this.deps.settingsOwner.readToolExecutionPolicy(),
        getToolGovernance: () =>
          this.deps.sessionClient.toolCatalog.readGovernance(),
        config: this.deps.config,
        messageBus: this.deps.messageBus,
        resolveClient: this.deps.resolveClient,
        approvalHandler: this.deps.approvalHandler,
        displayCallbacks: this.deps.displayCallbacks,
      },
      () => this.deps.sessionClient.prepareProfileClientReplacement(),
      () => this.activeRun,
    )(changed, signal);

  private buildSessionControl(): SessionControl {
    const mediaStore =
      this.deps.mediaStore ?? this.deps.resolveClient().mediaStore;
    if (mediaStore === undefined)
      throw new Error('Agent client requires explicit media store');
    const sessionDeps: SessionControlDeps = {
      readRecordingQueueLimit: () =>
        this.deps.settingsOwner.readRecordingQueueLimit(
          this.deps.config.getSessionRecordingQueueByteLimit(),
        ),
      config: this.deps.config,
      directories: () => this.deps.mcpOperations.workspacePaths.directories(),
      mediaStore,
      persistence: new AgentSessionPersistence(
        {
          projectRoot: this.deps.config.storageRoot,
          chatsDir: this.deps.config.projectChatsDir,
        },
        {
          mediaStore,
          maxQueueBytes: this.deps.config.getSessionPersistenceQueueByteLimit(),
        },
      ),
      sessionIdentityOwnership: this.deps.sessionIdentityOwnership,
      sessionId: () => this.deps.runtimeId,
      resolveClient: () => this.deps.resolveClient(),
      getProvider: () => this.providerState.provider,
      getModel: () => this.getModel(),
    };
    return new SessionControl(sessionDeps);
  }

  /**
   * The representative facade-held injected-factory scheduler handle (T19
   * conditional), or undefined when no injected toolSchedulerFactory created a
   * retained instance. Read live from ownership.injectedSchedulerHandles (the
   * handle is pushed lazily during the first tool turn, AFTER construction), so
   * the T13 probe — captured post-turn — observes the genuine recording handle
   * whose real `disposed` boolean dispose() flips (dispose.md line 41). The SAME
   * handle dispose() tears down.
   * @plan:PLAN-20260617-COREAPI.P24
   * @requirement:REQ-016
   */
  get injectedFactoryScheduler(): AgentSchedulerHandle | undefined {
    return this.ownership.injectedSchedulerHandles[0];
  }

  /**
   * The confirmationCoordinator backing the facade-held injected-factory
   * scheduler (T19 conditional). The injected recording fake produces ONE handle
   * carrying `disposed`; per dispose.md the coordinator is owned by that
   * scheduler, so this references the SAME recording handle whose `disposed`
   * flag flips on dispose() (dispose.md line 46). Read live so the post-turn
   * probe observes the lazily-created handle.
   * @plan:PLAN-20260617-COREAPI.P24
   * @requirement:REQ-016
   */
  get injectedFactoryCoordinator(): AgentSchedulerHandle | undefined {
    return this.ownership.injectedSchedulerHandles[0];
  }

  /**
   * Builds the HookControl wired to the live Config (HookSystem + enable flag)
   * and the SHARED MessageBus, so onHookExecution observes bus-mediated hook
   * executions and triggerSessionStart/triggerSessionEnd fire the real
   * lifecycle hooks.
   * @plan:PLAN-20260617-COREAPI.P23
   * @requirement:REQ-015
   */
  private buildHookControl(): HookControl {
    return createAgentHookControl(
      this.deps.sessionClient.hookOperations,
      this.deps.messageBus,
      this.readHookSessionId,
      () => this.deps.config.getTargetDir(),
      () => currentRecordingPath(this.session),
    );
  }

  /**
   * Seeds the per-agent auth state from the threaded initial auth config.
   * inlineKeyPresent from auth.apiKey, keyFile from auth.apiKeyFile, baseUrl
   * from auth.baseUrl, oauthEnabled add(provider) if auth.oauth, keyName seed
   * onto providerState.keyName from auth.keyName. The secret value is NEVER
   * stored on authState or providerState.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  private seedAuthState(provider: string): void {
    const initialAuth = this.deps.initialAuth;
    if (initialAuth === undefined) {
      return;
    }
    this.authState.inlineKeyPresent = initialAuth.apiKey !== undefined;
    this.authState.keyFile = initialAuth.apiKeyFile;
    this.authState.baseUrl = initialAuth.baseUrl;
    if (initialAuth.oauth === true) {
      this.authState.oauthEnabled.add(provider);
    }
    if (initialAuth.keyName !== undefined) {
      this.providerState.keyName = initialAuth.keyName;
    }
  }

  /**
   * Builds the AuthControl wired with the per-agent auth-state deps bundle.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  private buildAuthControl(): AuthControl {
    const { settingsService } = this.deps;
    const onOAuthPromptHandler = isOAuthPromptHandler(this.deps.onOAuthPrompt)
      ? this.deps.onOAuthPrompt
      : undefined;
    const keysDeps = {
      authState: this.authState,
      getKeyName: () => this.providerState.keyName,
      setKeyName: (keyName: string | undefined) => {
        this.providerState.keyName = keyName;
      },
      updateProviderApiKey: async (apiKey: string | null) => {
        await updateActiveProviderApiKey(
          apiKey,
          {
            setEphemeralSetting: (key, value) =>
              this.deps.settingsOwner.writeUserParameter(key, value),
          },
          settingsService,
          this.deps.providerManager.getActiveProvider(),
        );
      },
    };
    return new AuthControl({
      authState: this.authState,
      getCurrentProvider: () => this.providerState.provider,
      getKeyName: () => this.providerState.keyName,
      getStatus: (provider) => this.computeAuthStatusForProvider(provider),
      onOAuthPrompt: onOAuthPromptHandler,
      setBaseUrl: async (baseUrl) => {
        this.providerState.baseUrl = baseUrl ?? undefined;
        try {
          await updateActiveProviderBaseUrl(
            baseUrl ?? '',
            {
              setEphemeralSetting: (key, value) =>
                this.deps.settingsOwner.writeUserParameter(key, value),
            },
            this.deps.settingsService,
            this.providerState.provider,
          );
        } catch {
          // No-op under the fake seam.
        }
      },
      keysDeps,
      // @plan:PLAN-20260622-COREAPIGAP.P12 @requirement:REQ-005
      getOAuthManager: () => this.deps.oauthManager,
    });
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
  private buildMcpControl(): McpControl {
    // @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006 @pseudocode Dependencies/buildMcpControl
    const mcp = this.deps.mcpOperations;
    return buildOwnedMcpControl(mcp, {
      toolSelection: this.deps.sessionClient.toolCatalog.selection,
      config: this.deps.config,
      isMcpAuthenticated: (server) => this.authState.mcpAuth.has(server),
      markAuthenticated: (server) => this.authState.mcpAuth.add(server),
      resolveClient: () => this.deps.resolveClient(),
    });
  }

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
    return streamForegroundRun(
      assembleForegroundRun(
        {
          recording: createRecordingExecution(
            this.session,
            this.readHookSessionId,
            this.deps.sessionClient.hookOperations,
          ),
          isApplying: () => this.profiles.isApplying(),
          isReady: () => this.isProviderReady(),
          admitRun: (run) => this.coordinator.admit(run),
          releaseRun: (run) => this.coordinator.release(run),
          awaitDiscovery: () => this.deps.mcpOperations.awaitDiscovery(),
          notifyConfirmation: this.tools.notifyConfirmation.bind(this.tools),
          notifyToolUpdate: this.tools.notifyToolUpdate.bind(this.tools),
        },
        this.deps.settingsService,
        this.deps.providerManager,
        this.deps.loopHolder,
        this.deps.resolveClient,
        () => this.rebuild(),
        () => this.getModel(),
      ),
      input,
      opts,
    );
  }

  /**
   * Drains stream() into an AgentResult.
   *
   * Non-interactive parity (REQ-021): the returned AgentResult carries
   * text + toolCalls + finishReason + optional error + optional usage —
   * everything a thin runNonInteractive wrapper needs to render text/json,
   * split stdout/stderr, auto-answer tools (via the wrapped onApproval handler
   * threaded into the loop), and choose an exit status — without deep imports.
   * @plan:PLAN-20260617-COREAPI.P15
   * @plan:PLAN-20260617-COREAPI.P26
   * @requirement:REQ-003
   * @requirement:REQ-021
   */
  async chat(input: AgentInput, opts?: TurnOptions): Promise<AgentResult> {
    // @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-013
    // The MCP discovery gate runs inside stream(): it awaits (bounded) and
    // surfaces per-server failures as warning notices without aborting the
    // turn (issue #2516). chat() simply drains stream() into an AgentResult.
    const drained = await drainToResult(this.stream(input, opts));
    return buildAgentResult(drained);
  }

  /**
   * Returns the configured provider per-agent (NOT the global runtime accessor,
   * which returns 'fake' under the LLXPRT_FAKE_RESPONSES seam).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   */
  getProvider(): string {
    return this.providerState.provider;
  }

  /**
   * Switches the active provider (and optional model) mid-session, preserving
   * conversation context. Wraps switchActiveProvider (rebuilds the content
   * generator internally) and, when a model is supplied, setActiveModel +
   * config.initializeContentGeneratorConfig (model-only rebuild). Then
   * rebuildLoop() so the next AgenticLoop.run binds to the CURRENT client.
   *
   * Returns the underlying switch result (changed / previousProvider /
   * nextProvider / defaultModel / infoMessages) so the interactive UI (Part B)
   * can replace direct `runtime.switchActiveProvider(name, opts)` calls. The
   * richer return is non-breaking for existing callers that await the promise
   * without reading the value.
   * @plan:PLAN-20260617-COREAPI.P16
   * @plan:PLAN-20270104-ISSUE2374.P04
   * @requirement:REQ-004
   * @requirement:REQ-005
   * @pseudocode switch-rebind.md steps 30-42
   */
  async setProvider(
    provider: string,
    model?: string,
    options?: AgentProviderSwitchOptions,
  ): Promise<AgentProviderSwitchResult> {
    this.assertProfileIdle();
    if (this.activeRun !== undefined) throw new AgentBusyError();
    return this.applyProviderSwitch(provider, model, options);
  }

  /**
   * Returns the per-agent provider status. Surfaces keyName ONLY when the
   * winner is 'keyName', and keyFile ONLY when the winner is 'keyfile' (REQ-008
   * precedence). baseUrl is surfaced when set (existing behavior).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @requirement:REQ-008
   */
  getProviderStatus(): ProviderStatus {
    return buildProfileProviderStatus(
      this.providerState,
      this.computeWinner(this.providerState.provider),
      this.authState.keyFile,
    );
  }

  /**
   * Returns the configured model per-agent (NOT the global runtime accessor).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   */
  getModel(): string {
    return (
      this.deps.settingsOwner.readSelectedModel() ?? this.providerState.model
    );
  }

  /**
   * Changes the active model (provider unchanged), preserving context.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @requirement:REQ-005
   * @pseudocode switch-rebind.md steps 50-60
   */
  async setModel(model: string): Promise<void> {
    this.assertProfileIdle();
    if (this.activeRun !== undefined) throw new AgentBusyError();
    if (!this.isProviderReady()) {
      throw new Error(UNCONFIGURED_AGENT_MESSAGE);
    }
    await this.setOwnerModel(model);
    await this.deps.sessionClient.refreshAuth();
    await this.restoreChatVisibility();
    this.rebuild();
    this.providerState.model = model;
  }

  /**
   * @plan:PLAN-20260621-COREAPIREMED.P14
   * @requirement:REQ-003
   * @pseudocode lines 10-15
   * Resolves the bound client FRESH on every call (R-CLIENT invariant — never
   * cache), null-guards a missing client, and delegates to the client's
   * current sequence model. Returns null when there is no active client or no
   * active load-balancer sequence model.
   */
  getCurrentSequenceModel(): string | null {
    // resolveClient mirrors core Config.getAgentClient, whose declared type is
    // non-nullable only because its backing field uses a definite-assignment
    // assertion (agentClient!). At runtime no client exists before
    // initialization, so widen to the truthful runtime type to keep a genuine
    // null-guard (the T9c contract: a missing client yields null, never throws).
    return projectCurrentSequenceModel(this.deps.resolveClient());
  }

  /**
   * @plan:PLAN-20260621-COREAPIREMED.P18
   * @requirement:REQ-005
   * @pseudocode lines 10-12
   */
  getRuntimeId(): string {
    return this.deps.runtimeId;
  }

  /**
   * Returns the single session MessageBus the facade owns — the SAME instance
   * threaded through the loop, scheduler, and OAuth manager (no second bus).
   * When fromConfig adopted a caller-supplied bus, this returns that exact
   * instance so UI / non-interactive CLI consumers use the agent-owned bus
   * instead of constructing their own (#2378).
   * @plan:PLAN-20270110-ISSUE2378.P01
   * @requirement:REQ-2378-001
   */
  getMessageBus(): MessageBus {
    return this.deps.messageBus;
  }

  /** @plan:PLAN-20260621-COREAPIREMED.P12 @requirement:REQ-002 @pseudocode lines 20-22 */
  getEphemeralSetting(key: string): unknown {
    this.coordinator.assertSettingsAdmission();
    return this.deps.settingsOwner.readNamedParameter(key);
  }

  /** @plan:PLAN-20260621-COREAPIREMED.P12 @requirement:REQ-002 @pseudocode lines 30-33 */
  setEphemeralSetting(key: string, value: unknown): void {
    this.assertProfileIdle();
    this.deps.settingsOwner.writeUserParameter(key, value);
  }

  /** @plan:PLAN-20260621-COREAPIREMED.P12 @requirement:REQ-002 @pseudocode lines 40-42 */
  getEphemeralSettings(): Readonly<Record<string, unknown>> {
    this.coordinator.assertSettingsAdmission();
    return this.deps.settingsOwner.captureNamedParameters();
  }

  /**
   * @plan:PLAN-20260622-COREAPIGAP.P04
   * @requirement:REQ-001
   * @pseudocode lines 1-4
   */
  getApprovalMode(): ApprovalMode {
    return this.ide.isTrustedFolder()
      ? this.deps.config.getApprovalMode()
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
    this.deps.config.setApprovalMode(mode);
  }

  /**
   * Returns a readonly shallow snapshot of the per-agent model params.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @pseudocode switch-rebind.md steps 110-112
   */
  getModelParams(): Readonly<Record<string, unknown>> {
    return snapshotModelParams(this.providerState.modelParams);
  }

  /**
   * Lazily sets a model param (no content-generator rebuild); the next provider
   * ordinary admission reads it. Also updates the per-agent map so getModelParams reflects it.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @pseudocode switch-rebind.md steps 90-94
   */
  setModelParam(key: string, value: unknown): void {
    this.coordinator.assertNoCommit();
    const { providerManager, settingsService } = this.deps;
    const providerName = providerManager.getActiveProviderName();
    setActiveModelParam(key, value, settingsService, providerName);
    this.providerState.modelParams[key] = value;
  }

  /**
   * Lazily clears a model param (no rebuild).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @pseudocode switch-rebind.md steps 100-103
   */
  clearModelParam(key: string): void {
    this.coordinator.assertNoCommit();
    const { providerManager, settingsService } = this.deps;
    const providerName = providerManager.getActiveProviderName();
    clearActiveModelParam(key, settingsService, providerName);
    delete this.providerState.modelParams[key];
  }

  async getHistory(): Promise<readonly AgentMessage[]> {
    return this.deps.resolveClient().getHistory();
  }

  async setHistory(
    history: readonly AgentMessage[],
    opts?: { readonly stripThoughts?: boolean },
  ): Promise<void> {
    const client = this.deps.resolveClient();
    await client.setHistory(
      [...history] as Parameters<typeof client.setHistory>[0],
      opts,
    );
  }

  /**
   * Appends a single message to the live conversation history by delegating to
   * the client's addHistory contract. The next turn observes the injected
   * message as part of the prior context.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  async addHistory(message: AgentMessage): Promise<void> {
    const client = this.deps.resolveClient();
    await client.addHistory(message);
  }

  /**
   * Restores a curated history (IContent[] items) by delegating to the client's
   * restoreHistory contract. Mirrors the existing setHistory spread-cast
   * pattern to satisfy the contract's mutable IContent[] parameter under TS
   * strict.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  async restoreHistory(items: readonly AgentHistoryItem[]): Promise<void> {
    const client = this.deps.resolveClient();
    await client.restoreHistory([...items]);
  }

  /**
   * Resets the chat through the durable history-clear path while recording is
   * active, preserving its initial history prefix unless
   * `retainInitialHistory` is false. Without recording, delegates to the
   * client's full reset contract.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  async resetChat(options?: HistoryClearOptions): Promise<void> {
    if (this.session.getRecording().enabled) {
      await this.session.clearHistory(options);
      return;
    }
    const client = this.deps.resolveClient();
    await client.resetChat();
  }

  /**
   * Rebuilds and applies the system instruction for the next turn by delegating
   * to the client's updateSystemInstruction contract.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  async updateSystemInstruction(): Promise<void> {
    const client = this.deps.resolveClient();
    await client.updateSystemInstruction();
  }

  /**
   * Adds directory context to the system prompt for the next turn by delegating
   * to the client's addDirectoryContext contract.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  async addDirectoryContext(): Promise<void> {
    const client = this.deps.resolveClient();
    await client.addDirectoryContext();
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
    const promptId = opts?.promptId ?? `compress-${Date.now()}`;
    // Ensure the chat is initialized before accessing it: setHistory can run
    // before the first turn (startChat is otherwise lazy on first turn).
    return executeHookCompression(
      promptId,
      () => this.restoreChatVisibility(),
      () => this.deps.resolveClient().getChat(),
      this.session,
      this.readHookSessionId,
      this.deps.sessionClient.hookOperations,
      () => this.historyService,
    );
  }

  /**
   * Returns a populated SessionStats snapshot projected from the in-process
   * uiTelemetryService singleton and the HistoryService. Every field is
   * guaranteed to be a number (defaulting to 0 via ?? 0).
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  readonly getStats = (): SessionStats =>
    projectSessionStats(this.historyService);

  /**
   * Subscribes to live SessionStats updates. Stats are sourced from the
   * uiTelemetryService 'update' event (fired during a stream turn). A single
   * immediate projection is also delivered at subscription time so callers are
   * guaranteed at least one stats frame even if no turn runs before the
   * subscription is torn down.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  readonly onStats = (cb: (stats: SessionStats) => void): Unsubscribe =>
    subscribeSessionStats(() => this.historyService, cb);

  /**
   * Side-channel single-shot generation. Delegates to the client's detached
   * direct-message path (generateDirectMessage), which does NOT append to the
   * conversation history and does NOT run a tool loop. Returns the response
   * text (empty string when the model emits no text part).
   * @plan:PLAN-20260617-COREAPI.P21
   * @requirement:REQ-012
   */
  async generate(input: AgentInput, opts?: GenerateOptions): Promise<string> {
    if (!this.isProviderReady()) {
      throw new Error(UNCONFIGURED_AGENT_MESSAGE);
    }
    const client = this.deps.resolveClient();
    return generateDetachedText(
      input,
      opts?.promptId ?? `generate-${Date.now()}`,
      client.generateDirectMessage.bind(client),
      createRecordingExecution(
        this.session,
        this.readHookSessionId,
        this.deps.sessionClient.hookOperations,
      ),
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
    if (!this.isProviderReady()) {
      throw new Error(UNCONFIGURED_AGENT_MESSAGE);
    }
    const client = this.deps.resolveClient();
    const contentsArr = [...contents];
    const signal = opts?.signal ?? new AbortController().signal;
    const model = opts?.model ?? this.getModel();
    return client.generateJson(contentsArr, { ...schema }, signal, model);
  }

  /**
   * Side-channel embedding generation. Delegates to the client's
   * generateEmbedding contract against a snapshot copy of the input texts —
   * detached from the live conversation history.
   * @plan:PLAN-20260617-COREAPI.P21
   * @requirement:REQ-012
   */
  async generateEmbedding(texts: readonly string[]): Promise<number[][]> {
    if (!this.isProviderReady()) {
      throw new Error(UNCONFIGURED_AGENT_MESSAGE);
    }
    return this.deps.resolveClient().generateEmbedding([...texts]);
  }

  /**
   * Returns a concrete ProviderInfo[] from the runtime provider manager.
   * @plan:PLAN-20260617-COREAPI.P15
   * @requirement:REQ-017
   */
  listProviders(): readonly ProviderInfo[] {
    const names = this.deps.providerManager.listProviders();
    return buildProviderInfos(names, new Set(names));
  }

  /** Projects the enriched ToolInfo[] from the registry (added by #2376). */
  listTools(): readonly ToolInfo[] {
    const registry = this.deps.sessionClient.toolCatalog.selection;
    return buildToolInfosFromRegistry(
      registry.getAllTools(),
      new Set(registry.getEnabledTools().map((t) => t.name)),
    );
  }

  /**
   * Per-agent HistoryService accessor (per-access; never cached). Falls back to
   * the eagerly-stored initialHistoryService when the client's chat has not been
   * initialized (startChat runs lazily on the first turn), so the REQ-005
   * identity probe returns a non-null instance BEFORE the first turn. Because
   * transferHistoryToNewClient reuses the SAME stored instance across a
   * switch, the before/after identity matches.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-005
   */
  get historyService(): HistoryService | null {
    return (
      this.deps.resolveClient().getHistoryService() ??
      this.deps.initialHistoryService ??
      null
    );
  }

  // ─── P16 switch/context-preservation helpers ─────────────────────────────

  /**
   * Core provider(+optional model) switch used by both setProvider and
   * profiles.apply. switchActiveProvider rebuilds the content generator
   * internally (try/catch for the fake seam where the named provider is not
   * registered). When a model is supplied, setActiveModel + the explicit
   * model-only rebuild. Then rebuildLoop(). Updates the per-agent state holder.
   *
   * Returns the underlying ProviderSwitchResult so setProvider can surface
   * changed/previousProvider/nextProvider/defaultModel/infoMessages to the
   * interactive UI. Under the fake-seam suppressed branch (provider not
   * registered), synthesizes a `{changed:false}` result.
   * @plan:PLAN-20260617-COREAPI.P16
   * @plan:PLAN-20270104-ISSUE2374.P04
   * @requirement:REQ-004
   * @requirement:REQ-005
   * @pseudocode switch-rebind.md steps 30-42
   */
  private async applyProviderSwitch(
    provider: string,
    model?: string,
    options?: AgentProviderSwitchOptions,
  ): Promise<AgentProviderSwitchResult> {
    const previousProvider = this.providerState.provider;
    // switchActiveProvider rebuilds the content generator internally; under the
    // fake seam the named provider is not registered and this throws (no-op).
    let providerChanged = false;
    let infoMessages: readonly string[] = [];
    let defaultModel: string | undefined;
    try {
      const switchResult = await this.deps.switchProvider(
        provider,
        toRuntimeSwitchOptions(options),
      );
      providerChanged = switchResult.changed;
      infoMessages = switchResult.infoMessages;
      defaultModel = switchResult.defaultModel;
    } catch (error) {
      // Only the EXPECTED fake-seam case is suppressed: the fake seam sets
      // LLXPRT_FAKE_RESPONSES to a fixture-file path (never the string '1'), so
      // the seam predicate is simply "the env var is set at all". A REAL
      // provider-switch failure (env var not set) must propagate so a genuine
      // failure is never reported as success — facade state below is then left
      // untouched.
      const isFakeSeam = process.env.LLXPRT_FAKE_RESPONSES !== undefined;
      if (!isFakeSeam) {
        throw error;
      }
      // Provider not registered (fake seam) — the active provider handles all
      // requests. Per-agent state still reflects the switch (getProvider etc.).
    }
    if (providerChanged) {
      // Real provider switch succeeded; apply the requested model (if any) via
      // setActiveModel + the explicit model-only rebuild.
      if (model !== undefined && model !== this.providerState.model) {
        await this.setOwnerModel(model);
        await this.deps.sessionClient.refreshAuth();
      }
      await this.restoreChatVisibility();
    } else if (model !== undefined && model !== this.providerState.model) {
      // Same provider, different model — apply the model to the runtime
      // without reinitializing the content generator (the provider did not
      // change, so the client/HistoryService identity is preserved).
      // setActiveModel updates the model on the existing provider; the
      // rebuild() below propagates it to the loop (#2374 deepthinker finding).
      await this.setOwnerModel(model);
    }
    // Under the fake seam (providerChanged === false), the client is unchanged;
    // history/HistoryService identity is trivially preserved (same client).
    this.providerState.provider = provider;
    if (model !== undefined) {
      this.providerState.model = model;
    }
    this.rebuild();
    return {
      changed: providerChanged,
      previousProvider:
        previousProvider === UNCONFIGURED_PROVIDER ? null : previousProvider,
      nextProvider: provider,
      ...(defaultModel !== undefined ? { defaultModel } : {}),
      infoMessages,
    };
  }

  /**
   * After a client-rebinding mutation, the new client's chat is not yet
   * initialized. The prior conversation is carried onto the new client by
   * transferHistoryToNewClient (as history content) and surfaced by the new
   * client's getHistory() before its chat exists. Seeding startChat() with that
   * carried-over history makes the chat visible WITHOUT dropping prior context,
   * preserving the conversation across the rebind for REQ-005.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-005
   */
  private setOwnerModel(
    model: string,
  ): ReturnType<typeof setAgentSelectedModel> {
    return setAgentSelectedModel(model, this.deps);
  }

  private restoreChatVisibility(): Promise<void> {
    return restoreAgentChatVisibility(this.deps.resolveClient());
  }

  /**
   * Applies a profile's modelParams onto the live agent via the lazy runtime
   * mutators and updates the per-agent map (used by profiles.apply).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-009
   * @pseudocode switch-rebind.md steps 90-94
   */
  private assertProfileIdle(): void {
    this.coordinator.assertNoCommit();
    if (this.profiles.isApplying()) throw new AgentBusyError();
  }

  /**
   * Rebuilds the cached AgenticLoop bound to the CURRENT client (AgenticLoop
   * caches its constructor client and never re-resolves).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @pseudocode switch-rebind.md steps 10-26 (rebuildLoop call)
   */
  private rebuild(): void {
    this.deps.rebuildLoop({
      telemetry: this.deps.settingsOwner.telemetry,
      loopHolder: this.deps.loopHolder,
      toolSelection: this.deps.sessionClient.toolCatalog.selection,
      readApprovalMode: () => this.getApprovalMode(),
      readExecutionPolicy: () =>
        this.deps.settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        this.deps.sessionClient.toolCatalog.readGovernance(),
      resolveClient: this.deps.resolveClient,
      config: this.deps.config,
      messageBus: this.deps.messageBus,
      approvalHandler: this.deps.approvalHandler,
      displayCallbacks: this.deps.displayCallbacks,
    });
  }

  /**
   * Provider readiness: true when the manager reports an active provider.
   * Used by the fail-closed guards on stream/generate/generateJson/
   * generateEmbedding/compress/setModel to prevent model-dependent operations
   * when no provider is configured.
   */

  private readonly readHookSessionId = (): string => this.deps.runtimeId;
  private isProviderReady(): boolean {
    if (this.ownership.disposed) throw new Error('Agent is closed');
    return this.deps.providerManager.hasActiveProvider();
  }

  /** Computes the auth status for an explicit provider. @plan:PLAN-20260617-COREAPI.P18 @requirement:REQ-008 */
  private computeAuthStatusForProvider(provider: string): AuthStatus {
    const winner = this.computeWinner(provider);
    return winner !== 'none' ? 'authenticated' : 'unauthenticated';
  }

  /** Computes the REQ-008 precedence winner. @plan:PLAN-20260617-COREAPI.P18 @requirement:REQ-008 */
  private computeWinner(provider: string): AuthWinner {
    return computeAuthWinner(
      this.authState,
      this.providerState.keyName,
      provider,
    );
  }

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
   *   60    config.dispose() (agentClient)
   *   70    config.shutdownLspService() (NET-NEW) + set lspShutDown marker
   *   80    extensions teardown (NET-NEW, headless no-op) + extensionsDisposed
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

  dispose(): Promise<void> {
    this.lifecycle ??= this.createShutdownLifecycle();
    return this.lifecycle.dispose();
  }

  private stopShutdownAdmissions(): readonly SessionCleanupAction[] {
    return [
      () => {
        this.ownership.disposed = true;
      },
      () => this.deps.taskLaunchOwner.closeAdmissionAndAbort(),
      () => this.deps.sessionClient.closeHookAdmission(),
      () => this.hooks.closeAdmission(),
      () => this.profilePersistence.closeAdmission(),
      () => this.deps.mcpOperations.closeAdmission(),
      () => this.deps.shellOwner.closeAdmission(),
      () => this.newControls.closeAdmission(),
      () => this.session.closeAdmission(),
    ];
  }

  private createShutdownLifecycle(): SessionLifecycle {
    const errors: unknown[] = [];
    const pending: Array<Promise<void>> = [];
    const run = this.activeRun;
    const holder = this.deps.loopHolder;
    const start = (action: SessionCleanupAction): void => {
      pending.push(collectDisposalError(errors, action));
    };
    return new SessionLifecycle({
      stopAdmissions: [
        ...this.stopShutdownAdmissions(),
        () => start(() => this.deps.sessionClient.closeImageAdmission()),
        () => start(() => this.deps.sessionClient.toolCatalog.closeAdmission()),
        () => start(() => this.tools.dispose()),
      ],
      abortActiveAndPending: [
        () => run?.controller.abort(),
        () => holder.activeRunController?.abort(),
        () => start(() => this.coordinator.dispose()),
        () => start(() => this.deps.shellOwner.dispose()),
      ],
      cancelAndJoinOwnedWork: [
        () =>
          joinAgentWork(
            this,
            this.deps.taskLaunchOwner,
            this.ownership,
            errors,
          ),
        () => joinCapturedRun(run, errors),
        () =>
          collectDisposalError(errors, () => this.profilePersistence.join()),
        async () => {
          await Promise.all(pending);
        },
      ],
      flushRecording: [
        async () => {
          await finishOwnedHooks(this.hooks, this.deps.sessionClient, errors);
          await disposeAgentObservers(
            this.ownership,
            this.hooks,
            this.newControls,
            holder.subscriptions,
            errors,
          );
          await collectDisposalError(errors, () => this.session.dispose());
        },
      ],
      releaseResources: [
        async () => {
          await this.releaseShutdownResources(errors);
          if (errors.length > 0) throw new AggregateDisposeError(errors);
        },
      ],
    });
  }

  private async releaseShutdownResources(errors: unknown[]): Promise<void> {
    await collectDisposalError(errors, () => this.deps.sessionClient.dispose());
    await collectDisposalError(errors, () => this.deps.runtimeHandle.cleanup());
    await disposeConfigInfrastructure(
      this.ownership,
      this.deps.mediaOwner,
      errors,
    );
    this.ownership.extensionsDisposed = true;
    await releaseAgentFinalResources(
      this.ownership,
      this.deps.oauthManager,
      errors,
    );
  }
}

/**
 * Factory that injects bootstrap deps into AgentImpl.
 * @pseudocode createAgent.md steps 150-160
 */
export function buildAgent(deps: AgentDeps): Agent {
  return new AgentImpl(deps);
}
