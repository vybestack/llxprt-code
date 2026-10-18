import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { WorkspaceSkillOperations } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { ChildToolDisplay } from '../session/childToolDisplay.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import type { ShellJobOwner } from '../session/shell-job-owner.js';
import type { TaskLaunchOwner } from '../session/task-launch-owner.js';
import { AgentProviderFileDomain } from './provider-file-domain.js';
import { assembleProviderSwitch } from './providerSwitchAssembly.js';

import type { Config, ProviderSwitcher } from '@vybestack/llxprt-code-core';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { AgentMcpOperations } from './mcpRuntimeAssembly.js';

import type { StableDisplayCallbacksHolder } from './agentBootstrap.js';
import type { AgentAuth } from './config-types.js';

import { assembleSettingsControl } from './control/settings-control.js';
import { assembleToolFormatControl } from './control/tool-format-control.js';
import { generateSessionText } from './detached-generation.js';
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

import {
  ApprovalMode,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { executeHookCompression } from './compression-execution.js';
// @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
// @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
import { assembleToolKeys } from './control/toolKeysControl.js';

import { assembleModelParameterControl } from './model-parameters.js';
import {
  assembleProfilePersistence,
  buildProfileProviderStatus,
  restoreAgentChatVisibility,
  snapshotModelParams,
} from './profilePersistenceAssembly.js';
import {
  applyFacadeAuthBaseUrl,
  updateActiveProviderApiKey,
} from './providerMutations.js';

import type {
  Agent,
  AgentHistoryItem,
  AgentInput,
  AgentMemoryControl,
  AgentMessage,
  AgentProviderSwitchOptions,
  AgentProviderSwitchResult,
  AgentResult,
  CompressionResult,
  GenerateOptions,
  ProviderInfo,
  ProviderStatus,
  SessionStats,
  ToolInfo,
  TurnOptions,
  Unsubscribe,
} from './agent.js';
import { AgentExecutionCoordinator } from './agentExecutionCoordinator.js';
import type { McpControl } from './control/mcpControl.js';
import { ToolControl } from './control/toolControl.js';
import type { ActiveRun } from './directProviderAdmission.js';
import type { AgentEvent } from './event-types.js';
import { ForegroundRunLifecycle } from './foregroundRunLifecycle.js';
import { assembleDirectProviderAdmission } from './directProviderAdmission.js';
import { createNewSessionAdmission } from './new-session-admission.js';
// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006

import { AuthControl, isOAuthPromptHandler } from './control/authControl.js';
import { createAgentHookControl, type HookControl } from './control/hooks.js';
import type { IdeControl } from './control/ideControl.js';
import type { LspControl } from './control/lspControl.js';
import { PolicyControl } from './control/policyControl.js';
import { ProfilesControl } from './control/profilesControl.js';
import { SessionControl } from './control/sessionControl.js';
import { SkillsControl } from './control/skillsControl.js';
import type { TasksControl } from './control/tasksControl.js';
import { createTasksControl } from './control/tasksControl.js';
import type { WorkspaceControl } from './control/workspaceControl.js';
import { assembleProfileApplication } from './profileApplicationAssembly.js';
import { captureProfileModelParams } from './profileSnapshot.js';
import {
  createRecordingExecution,
  currentRecordingPath,
} from './recordingExecution.js';
import {
  idleClient,
  initializeProviderState,
  resetIdleChat,
} from './session-control-assembly.js';
import { SessionProviderReads } from './session-provider-reads.js';

import {
  buildAgentResult,
  buildProviderInfos,
  drainToResult,
  type OwnershipRecord,
} from './agentBootstrap.js';
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
import {
  projectCurrentSequenceModel,
  projectSessionStats,
  subscribeSessionStats,
} from './agentStatsProjector.js';
import type { AgentSchedulerHandle, EditorCallbacks } from './config-types.js';
import {
  authStatusForWinner,
  computeAuthWinner,
  type AgentAuthState,
  type AgentProviderState,
  type AuthWinner,
} from './control/authState.js';
import { AgentBusyError } from './loop/agentBusyError.js';
import { applyFacadeProviderSwitch } from './providerSwitchOptionsAdapter.js';

/**
 * Actionable error message used when the Agent is unconfigured — no active
 * provider is set on the manager. Every model-dependent path must fail
 * closed with this message so the user is guided to /setup.
 */
const UNCONFIGURED_AGENT_MESSAGE =
  'No provider is configured. Run /setup to choose a hosted provider, configure a local model, set up a custom compatible endpoint, or select an existing profile before using the agent.';

import type {
  SessionCleanupAction,
  SessionLifecycle,
} from './sessionLifecycle.js';

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

/**
 * AgentImpl — the concrete Agent built by createAgent via buildAgent.
 * @plan:PLAN-20260617-COREAPI.P15
 * @requirement:REQ-001
 * @requirement:REQ-003
 */
export class AgentImpl extends AgentProviderFileDomain implements Agent {
  private readonly coordinator = new AgentExecutionCoordinator();
  readonly execution: Agent['execution'] = this.coordinator;
  private get activeRun(): ActiveRun | undefined {
    return this.coordinator.current();
  }

  /** @plan:PLAN-20260622-COREAPIGAP.P08 @requirement:REQ-003 */

  /** @pseudocode createAgent.md steps 150-160 */

  /**
   * The runtime ProviderManager the facade governs. Exposed (mirroring
   * messageBus/agentClient) so identity probes can assert the adopted manager
   * is the SAME instance the caller supplied (CRIT-1: no second manager).
   * @plan:PLAN-20260621-COREAPIREMED.P09
   * @requirement:REQ-001
   */

  /**
   * The runtimeId the facade was built with. Exposed (mirroring
   * messageBus/agentClient) so identity probes can assert the deterministic
   * sessionId-derived runtime id.
   * @plan:PLAN-20260621-COREAPIREMED.P09
   * @requirement:REQ-001
   */

  /**
   * The single shared MessageBus createAgent threaded through every surface.
   * Exposed so the T13 disposal probe can read the private emitter's listener
   * tally and assert it reaches zero after dispose() unsubscribes every recorded
   * subscription (dispose.md lines 50-52). This is the SAME bus instance — no
   * second bus is ever created.
   * @plan:PLAN-20260617-COREAPI.P24
   * @requirement:REQ-016
   */

  /**
   * The Config-owned AgentClient (the eager post-auth client refreshAuth
   * created). Captured at construction so the T13 disposal probe observes its
   * `handleModelChanged` handler leaving the coreEvents emitter after
   * config.dispose() disposes it (dispose.md line 60). The SAME instance
   * dispose() tears down.
   * @plan:PLAN-20260617-COREAPI.P24
   * @requirement:REQ-016
   */

  get agentClient(): AgentClientContract {
    return this.ownerClient.getAgentClient();
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

  /**
   * Per-agent mutable auth state (parallel to providerState). Carries every
   * auth-related field the public auth/keys controls mutate and that
   * computeAuthStatus/getProviderStatus read, EXCEPT the keyName reference
   * (which lives on providerState.keyName as the single source of truth). The
   * secret value lives ONLY in authState.keyStore and is NEVER surfaced.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */

  /** Mutable editor-callbacks holder shared with ToolControl + forwarding object. */

  /** Mutable display-callbacks holder shared with ToolControl + stable forwarding object. */

  readonly modelParameters = assembleModelParameterControl(
    (provider, key, value) =>
      this.settingsService.setProviderSetting(provider, key, value),
    () => this.providerManager.getActiveProviderName(),
    () => this.providerState.modelParams,
    () => this.coordinator.assertNoCommit(),
  );
  readonly settings: Agent['settings'] = assembleSettingsControl(
    (key) => this.settingsOwner.readNamedParameter(key),
    () => this.settingsOwner.captureNamedParameters(),
    (key, value) => this.settingsOwner.writeUserParameter(key, value),
    (key) => this.settingsOwner.readSessionOverride(key),
    (key, value) => this.settingsOwner.writeSessionOverride(key, value),
    (key) => this.settingsOwner.clearSessionOverride(key),
    () => this.coordinator.assertSettingsAdmission(),
    () => this.assertProfileIdle(),
    (listener) => this.settingsOwner.subscribeModelChanges(listener),
  );
  readonly toolFormat: Agent['toolFormat'] = assembleToolFormatControl(
    () => this.settingsOwner.readToolFormat(),
    (format) => this.settingsOwner.writeToolFormat(format),
    () => this.providerManager.getActiveProvider(),
    () => this.coordinator.assertSettingsAdmission(),
    () => this.assertProfileIdle(),
  );

  readonly metrics: Agent['metrics'];

  readonly providerReads: Agent['providerReads'];
  readonly hasActiveProvider: Agent['hasActiveProvider'] = () =>
    this.providerManager.hasActiveProvider();
  readonly getProviderContextLimit: Agent['getProviderContextLimit'] = () =>
    this.providerManager.getActiveProvider()?.getContextLimit?.();
  readonly listAvailableModels: Agent['listAvailableModels'] = (provider) =>
    this.providerManager.getAvailableModels(
      provider ?? this.getProviderStatus().provider,
    );
  readonly sessionClient: Agent['sessionClient'];
  private readonly profilePersistence: ReturnType<
    typeof assembleProfilePersistence
  >;
  readonly captureProfile: Agent['captureProfile'];
  readonly saveProfileSnapshot: Agent['saveProfileSnapshot'];
  readonly deleteProfileByName: Agent['deleteProfileByName'];
  readonly getActiveProfileName: Agent['getActiveProfileName'];
  readonly setDefaultProfileName: Agent['setDefaultProfileName'];
  readonly getRuntimeDiagnosticsSnapshot: Agent['getRuntimeDiagnosticsSnapshot'];
  private readonly providerState: AgentProviderState;
  readonly tools: ToolControl;
  readonly profiles: ProfilesControl;
  readonly auth: AuthControl;
  readonly session: SessionControl;
  readonly hooks: HookControl;
  readonly policy: PolicyControl;
  readonly tasks: TasksControl;
  readonly memory: AgentMemoryControl;
  readonly skills: SkillsControl;
  private readonly switchProvider: ProviderSwitcher;
  constructor(
    private readonly settingsOwner: SessionSettingsOwner,
    private readonly ownerClient: SessionClientOwner,
    workspaceSkills: WorkspaceSkillOperations,
    private readonly mediaStore: LocalMediaStore | undefined,
    private readonly mediaOwner: SessionMediaOwner | undefined,
    private readonly taskLaunchOwner: TaskLaunchOwner,
    private readonly shellOwner: ShellJobOwner,
    readonly workspace: WorkspaceControl,
    readonly ide: IdeControl,
    readonly lsp: LspControl,
    private readonly awaitMcpDiscovery: AgentMcpOperations['awaitDiscovery'],
    private readonly closeMcpAdmission: () => void,
    readonly mcp: McpControl,
    private readonly authState: AgentAuthState,
    private readonly config: Config,
    readonly providerManager: RuntimeProviderManager,
    private readonly oauthManager: OAuthManager,
    readRuntimeKind: () => RuntimeKind,
    private readonly settingsService: SettingsService,
    readonly runtimeId: string,
    private readonly closeRuntime: () => Promise<void> | void,
    readonly messageBus: MessageBus,
    private readonly runtimeState: AgentRuntimeState,
    readonly ownership: OwnershipRecord,
    private readonly sessionIdentityOwnership: 'config' | 'facade',
    private readonly resolveClient: () => AgentClientContract,
    private readonly initialHistoryService: HistoryService | undefined,
    private readonly editorCallbacksHolder: {
      editorCallbacks: EditorCallbacks;
    },
    private readonly displayCallbacksHolder: StableDisplayCallbacksHolder,
    private readonly onOAuthPrompt: unknown | undefined,
    private readonly initialAuth: AgentAuth | undefined,
    private readonly childDisplay: ChildToolDisplay | undefined,
    private readonly selectOwnerModel: (model: string) => Promise<void>,
    readonly authentication: Agent['authentication'],
  ) {
    super(
      ownerClient.createProviderFileOperations(() =>
        this.coordinator.assertSettingsAdmission(),
      ),
    );
    this.switchProvider = this.constructProviderSwitch(readRuntimeKind);
    this.metrics = this.settingsOwner.telemetry.localMetrics;
    this.providerReads = new SessionProviderReads(
      this.settingsOwner,
      this.providerManager,
      () => this.providerState.model,
      (provider) => this.settingsService.getProviderSettings(provider),
    );
    this.sessionClient = this.constructSessionClient();
    this.profilePersistence = this.constructProfilePersistence();
    this.captureProfile = this.profilePersistence.captureProfile;
    this.saveProfileSnapshot = this.profilePersistence.saveProfileSnapshot;
    this.deleteProfileByName = this.profilePersistence.deleteProfileByName;
    this.getActiveProfileName = this.profilePersistence.getActiveProfileName;
    this.setDefaultProfileName = this.profilePersistence.setDefaultProfileName;
    this.getRuntimeDiagnosticsSnapshot =
      this.profilePersistence.getRuntimeDiagnosticsSnapshot;
    this.providerState = initializeProviderState(
      this.runtimeState,
      this.initialAuth,
      this.authState,
    );
    this.tools = this.constructTools();
    this.profiles = this.constructProfiles();
    this.auth = this.buildAuthControl();
    this.session = this.buildSessionControl();
    this.hooks = this.buildHookControl();
    this.policy = new PolicyControl(this.ownerClient.policyInspection);
    this.tasks = createTasksControl(this.taskLaunchOwner, this.shellOwner);
    this.skills = new SkillsControl(workspaceSkills);
    this.memory = this.ownerClient.memoryOperations;
    this.releaseHooks = this.ownerClient.transferHookRelease();
  }
  private constructSessionClient(): Agent['sessionClient'] {
    return idleClient(this.ownerClient.operations, this.coordinator, () =>
      this.rebuild(),
    );
  }
  private constructProfilePersistence(): ReturnType<
    typeof assembleProfilePersistence
  > {
    return assembleProfilePersistence(
      () => this.config.getModel(),
      () => this.config.getProvider(),
      this.settingsService,
      this.providerManager,
      () => this.settingsOwner.captureNamedParameters(),
      this.workspace.profileWrites,
    );
  }
  private constructTools(): ToolControl {
    const assertSessionAdmission = (): void =>
      this.coordinator.assertNoCommit();
    this.taskLaunchOwner.bindSessionAdmission(assertSessionAdmission);
    this.shellOwner.bindSessionAdmission(assertSessionAdmission);
    return new ToolControl(
      (...args) => this.ownerClient.openClientToolChannel(...args),
      assertSessionAdmission,
      this.taskLaunchOwner,
      this.shellOwner,
      this.childDisplay,
      this.messageBus,
      this.ownerClient.toolCatalog.selection,
      (names) => this.settingsOwner.setAllowedTools(names),
      () => this.ownerClient.toolCatalog.describeConfiguration(),
      this.editorCallbacksHolder,
      this.displayCallbacksHolder,
      (calls) => this.ownerClient.recordCompletedToolCalls(calls),
      assembleToolKeys(),
    );
  }

  private constructProfiles(): ProfilesControl {
    const readString = (key: string): string | undefined => {
      const value = this.settingsOwner.readNamedParameter(key);
      return typeof value === 'string' && value.length > 0 ? value : undefined;
    };
    return new ProfilesControl(
      () => this.providerState,
      assembleProfileApplication(
        this.settingsService,
        this.providerManager,
        this.oauthManager,
        (name, options) =>
          this.switchProvider(name, {
            ...options,
            clientReplacement: 'deferred',
          }),
        this.settingsOwner,
        this.workspace.profileDefinitions,
        async (result, signal) => {
          const modelParams = captureProfileModelParams(
            this.settingsService.getProviderSettings(result.providerName),
          );
          const replacement = await this.prepareReplacement(
            result.providerChanged,
            signal,
          );
          return {
            publish: () => {
              replacement.publish();
              this.providerState.provider = result.providerName;
              this.providerState.model = result.modelName;
              this.providerState.modelParams = modelParams;
              this.providerState.baseUrl = result.baseUrl;
              this.providerState.keyName = readString('auth-key-name');
              this.providerState.isLoadBalancer =
                result.providerName === 'load-balancer';
              this.authState.keyFile = readString('auth-keyfile');
              this.authState.rawKeyPresent =
                readString('auth-key') !== undefined;
              this.authState.inlineKeyPresent = false;
              this.authState.baseUrl = result.baseUrl;
            },
            retire: () => replacement.retire(),
            discard: () => replacement.discard(),
          };
        },
        () => this.coordinator.assertIdle(),
      ),
      () => ({ ...this.settingsOwner.captureUserParameters() }),
      this.config.getTargetDir(),
    );
  }
  private constructProviderSwitch(
    readRuntimeKind: () => RuntimeKind,
  ): ProviderSwitcher {
    return assembleProviderSwitch(
      this.config,
      this.settingsService,
      this.providerManager,
      this.oauthManager,
      readRuntimeKind,
      () => this.ownerClient.refreshAuth(),
      this.settingsOwner,
    );
  }
  private readonly prepareReplacement = (
    changed: boolean,
    signal: AbortSignal,
  ) => {
    const active = this.activeRun;
    const run =
      active !== undefined && this.ownerClient.isCurrentExecution(active.loop)
        ? active
        : undefined;
    return this.ownerClient.prepareProfileExecution(
      changed,
      signal,
      (retire) => {
        if (run !== undefined && this.activeRun === run) {
          run.retirements = [...run.retirements, retire];
          return Promise.resolve();
        }
        return retire();
      },
    );
  };

  private buildSessionControl(): SessionControl {
    const config = this.config;
    const settingsOwner = this.settingsOwner;
    return new SessionControl(
      config,
      this.mediaStore,
      () =>
        settingsOwner.readRecordingQueueLimit(
          config.getSessionRecordingQueueByteLimit(),
        ),
      () => this.workspace.getDirectories(),
      this.sessionIdentityOwnership,
      () => this.runtimeId,
      () => this.resolveClient(),
      createNewSessionAdmission(
        this.taskLaunchOwner,
        this.shellOwner,
        this.coordinator,
        this.tools,
        () => this.assertProfileIdle(),
      ),
      () => this.coordinator.closeAdmission(),
      (id) => this.ownerClient.prepareNewSession(id, () => this.rebuild()),
      () => this.providerState.provider,
      () => this.getModel(),
      undefined,
    );
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
  private readonly releaseHooks: () => Promise<void>;

  private buildHookControl(): HookControl {
    return createAgentHookControl(
      this.ownerClient.hookOperations,
      this.messageBus,
      this.readHookSessionId,
      () => this.config.getTargetDir(),
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

  /**
   * Builds the AuthControl wired with the per-agent auth-state deps bundle.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  private buildAuthControl(): AuthControl {
    const settingsService = this.settingsService;
    const onOAuthPromptHandler = isOAuthPromptHandler(this.onOAuthPrompt)
      ? this.onOAuthPrompt
      : undefined;
    return new AuthControl(
      this.authState,
      () => this.providerState.provider,
      (provider) => authStatusForWinner(this.computeWinner(provider)),
      onOAuthPromptHandler,
      (baseUrl) =>
        applyFacadeAuthBaseUrl(
          baseUrl,
          this.providerState,
          (key, value) => this.settingsOwner.writeUserParameter(key, value),
          this.settingsService,
          this.providerState.provider,
        ),
      () => this.providerState.keyName,
      (name) => {
        this.providerState.keyName = name;
      },
      async (apiKey) => {
        this.coordinator.assertSettingsAdmission();
        return updateActiveProviderApiKey(
          apiKey,
          {
            setEphemeralSetting: (key, value) =>
              this.settingsOwner.writeUserParameter(key, value),
          },
          settingsService,
          this.providerManager.getActiveProvider(),
        );
      },
      (provider) => this.oauthManager.isOAuthEnabled(provider),
      (provider) => this.oauthManager.isAuthenticated(provider),
      async (provider) =>
        (await this.oauthManager.peekStoredToken(provider))?.expiry,
      (provider) => this.oauthManager.getHigherPriorityAuth(provider),
      (provider) => this.oauthManager.getAuthStatusWithBuckets(provider),
    );
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
      this.settingsService,
      this.providerManager,
      () => this.getModel(),
    );
    return new ForegroundRunLifecycle(
      createRecordingExecution(
        this.session,
        this.readHookSessionId,
        this.ownerClient.hookOperations,
      ),
      () => this.profiles.isApplying(),
      () => this.isProviderReady(),
      (run) => this.coordinator.admit(run),
      (run) => this.coordinator.release(run),
      () => this.ownerClient.resolveExecution(),
      () => admission.admit(),
      () => this.awaitMcpDiscovery(),
      this.tools.notifyConfirmation.bind(this.tools),
      this.tools.notifyToolUpdate.bind(this.tools),
    ).stream(input, opts);
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
  readonly getProvider = (): string => this.providerState.provider;

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
  readonly getProviderStatus = (): ProviderStatus =>
    buildProfileProviderStatus(
      this.providerState,
      this.computeWinner(this.providerState.provider),
      this.authState.keyFile,
    );

  /**
   * Returns the configured model per-agent (NOT the global runtime accessor).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   */
  readonly getModel = (): string => this.providerReads.getActiveModelName();

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
    await this.selectOwnerModel(model);
    await this.ownerClient.refreshAuth();
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
  readonly getCurrentSequenceModel = (): string | null =>
    projectCurrentSequenceModel(this.resolveClient());

  /**
   * @plan:PLAN-20260621-COREAPIREMED.P18
   * @requirement:REQ-005
   * @pseudocode lines 10-12
   */
  readonly getRuntimeId = (): string => this.runtimeId;

  /**
   * Returns the single session MessageBus the facade owns — the SAME instance
   * threaded through the loop, scheduler, and OAuth manager (no second bus).
   * When fromConfig adopted a caller-supplied bus, this returns that exact
   * instance so UI / non-interactive CLI consumers use the agent-owned bus
   * instead of constructing their own (#2378).
   * @plan:PLAN-20270110-ISSUE2378.P01
   * @requirement:REQ-2378-001
   */
  readonly getMessageBus = (): MessageBus => this.messageBus;

  /** @plan:PLAN-20260621-COREAPIREMED.P12 @requirement:REQ-002 @pseudocode lines 20-22 */
  readonly getEphemeralSetting = this.settings.getEphemeralSetting.bind(
    this.settings,
  );

  /** @plan:PLAN-20260621-COREAPIREMED.P12 @requirement:REQ-002 @pseudocode lines 30-33 */
  readonly setEphemeralSetting = this.settings.setEphemeralSetting.bind(
    this.settings,
  );

  /** @plan:PLAN-20260621-COREAPIREMED.P12 @requirement:REQ-002 @pseudocode lines 40-42 */
  readonly getEphemeralSettings = this.settings.getEphemeralSettings.bind(
    this.settings,
  );

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
   * Returns a readonly shallow snapshot of the per-agent model params.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @pseudocode switch-rebind.md steps 110-112
   */
  readonly getModelParams = (): Readonly<Record<string, unknown>> =>
    snapshotModelParams(this.providerState.modelParams);

  /**
   * Lazily sets a model param (no content-generator rebuild); the next provider
   * ordinary admission reads it. Also updates the per-agent map so getModelParams reflects it.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @pseudocode switch-rebind.md steps 90-94
   */
  readonly setModelParam = this.modelParameters.set.bind(this.modelParameters);

  /**
   * Lazily clears a model param (no rebuild).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @pseudocode switch-rebind.md steps 100-103
   */
  readonly clearModelParam = this.modelParameters.clear.bind(
    this.modelParameters,
  );

  readonly getHistory = async (): Promise<readonly AgentMessage[]> =>
    this.resolveClient().getHistory();

  async setHistory(
    history: readonly AgentMessage[],
    opts?: { readonly stripThoughts?: boolean },
  ): Promise<void> {
    const client = this.resolveClient();
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
  readonly addHistory = async (message: AgentMessage): Promise<void> =>
    this.resolveClient().addHistory(message);

  /**
   * Restores a curated history (IContent[] items) by delegating to the client's
   * restoreHistory contract. Mirrors the existing setHistory spread-cast
   * pattern to satisfy the contract's mutable IContent[] parameter under TS
   * strict.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  readonly restoreHistory = async (
    items: readonly AgentHistoryItem[],
  ): Promise<void> => this.resolveClient().restoreHistory([...items]);

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
      this.resolveClient().resetChat(),
    );
  }

  /**
   * Rebuilds and applies the system instruction for the next turn by delegating
   * to the client's updateSystemInstruction contract.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  readonly updateSystemInstruction = async (): Promise<void> =>
    this.resolveClient().updateSystemInstruction();

  /**
   * Adds directory context to the system prompt for the next turn by delegating
   * to the client's addDirectoryContext contract.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  readonly addDirectoryContext = async (): Promise<void> =>
    this.resolveClient().addDirectoryContext();

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
    return executeHookCompression(
      opts?.promptId ?? `compress-${Date.now()}`,
      () => this.restoreChatVisibility(),
      () => this.resolveClient().getChat(),
      this.session,
      this.readHookSessionId,
      this.ownerClient.hookOperations,
      () => this.historyService,
    );
  }

  /**
   * Returns a populated SessionStats snapshot projected from the in-process
   * session-owned metric source and the HistoryService. Every field is
   * guaranteed to be a number (defaulting to 0 via ?? 0).
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */

  readonly getStats = (): SessionStats =>
    projectSessionStats(this.historyService, this.metrics);

  /**
   * Subscribes to live SessionStats updates. Stats are sourced from the
   * session metric subscription (fired during a stream turn). A single
   * immediate projection is also delivered at subscription time so callers are
   * guaranteed at least one stats frame even if no turn runs before the
   * subscription is torn down.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  readonly onStats = (cb: (stats: SessionStats) => void): Unsubscribe =>
    subscribeSessionStats(() => this.historyService, cb, this.metrics);

  /**
   * Side-channel single-shot generation. Delegates to the client's detached
   * direct-message path (generateDirectMessage), which does NOT append to the
   * conversation history and does NOT run a tool loop. Returns the response
   * text (empty string when the model emits no text part).
   * @plan:PLAN-20260617-COREAPI.P21
   * @requirement:REQ-012
   */
  async generate(input: AgentInput, opts?: GenerateOptions): Promise<string> {
    if (!this.isProviderReady()) throw new Error(UNCONFIGURED_AGENT_MESSAGE);
    const client = this.ownerClient.getAgentClient();
    return generateSessionText(
      input,
      opts,
      client.generateDirectMessage.bind(client),
      this.session,
      this.ownerClient.hookOperations,
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
    return this.ownerClient.generateJson(
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
    return this.ownerClient.generateEmbedding(texts);
  }

  /**
   * Returns a concrete ProviderInfo[] from the runtime provider manager.
   * @plan:PLAN-20260617-COREAPI.P15
   * @requirement:REQ-017
   */
  listProviders(): readonly ProviderInfo[] {
    const names = this.providerManager.listProviders();
    return buildProviderInfos(names, new Set(names));
  }

  /** Projects the enriched ToolInfo[] from the registry (added by #2376). */
  readonly listTools = (): readonly ToolInfo[] => [...this.tools.list()];

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
      this.resolveClient().getHistoryService() ??
      this.initialHistoryService ??
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
  private applyProviderSwitch(
    provider: string,
    model?: string,
    options?: AgentProviderSwitchOptions,
  ): Promise<AgentProviderSwitchResult> {
    return applyFacadeProviderSwitch(
      provider,
      model,
      options,
      this.providerState,
      this.switchProvider,
      this.selectOwnerModel,
      () => this.ownerClient.refreshAuth(),
      this.restoreChatVisibility,
      () => this.rebuild(),
    );
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
  private readonly restoreChatVisibility = (): Promise<void> =>
    restoreAgentChatVisibility(this.resolveClient());

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
  private readonly rebuild = (): void => this.ownerClient.rebuildExecution();

  /**
   * Provider readiness: true when the manager reports an active provider.
   * Used by the fail-closed guards on stream/generate/generateJson/
   * generateEmbedding/compress/setModel to prevent model-dependent operations
   * when no provider is configured.
   */

  private readonly readHookSessionId = (): string =>
    this.session.getSessionId();
  private isProviderReady(): boolean {
    if (this.ownership.disposed) throw new Error('Agent is closed');
    return this.providerManager.hasActiveProvider();
  }

  /** Computes the auth status for an explicit provider. @plan:PLAN-20260617-COREAPI.P18 @requirement:REQ-008 */

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
      () => this.ownerClient.closeAdmission(),
      () => this.taskLaunchOwner.closeAdmissionAndAbort(),
      () => this.ownerClient.closeHookAdmission(),
      () => this.hooks.closeAdmission(),
      () => this.profilePersistence.closeAdmission(),
      () => this.closeMcpAdmission(),
      () => this.shellOwner.closeAdmission(),
      () => this.skills.closeAdmission(),
      () => this.workspace.closeAdmission(),
      () => this.session.closeAdmission(),
    ];
  }

  private createShutdownLifecycle(): SessionLifecycle {
    const run = this.activeRun;
    return assembleAgentShutdown(
      this.stopShutdownAdmissions(),
      [
        () => this.ownerClient.closeAuxiliaryAdmission(),
        () => this.ownerClient.closeImageAdmission(),
        () => this.ownerClient.toolCatalog.closeAdmission(),
        () => this.tools.dispose(),
      ],
      [() => run?.controller.abort(), () => this.ownerClient.abortExecution()],
      [() => this.coordinator.dispose(), () => this.shellOwner.dispose()],
      (errors) =>
        joinAgentWork(
          () => this.profiles.cancelAndJoin(),
          () => this.mcp.cancelAndJoin(),
          () => this.taskLaunchOwner.hasPendingWork(),
          () => this.taskLaunchOwner.join(),
          () => this.ownership.disposeMcpRuntime?.(),
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
          this.ownership.injectedSchedulerHandles,
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
    await collectDisposalError(errors, () => this.ownerClient.dispose());
    await collectDisposalError(errors, this.closeRuntime);
    await disposeConfigInfrastructure(
      this.ownership.configOwnership === 'caller'
        ? undefined
        : () => this.config.dispose(),
      this.mediaOwner?.dispose.bind(this.mediaOwner),
      errors,
    );
    if (this.ownership.configOwnership !== 'caller')
      this.ownership.lspShutDown = true;
    this.ownership.extensionsDisposed = true;
    for (const lock of this.ownership.sessionLocks)
      await collectDisposalError(errors, () => lock.release());
    this.ownership.sessionLocksReleased = true;
    await collectDisposalError(errors, () =>
      disposeOAuthManager(this.oauthManager),
    );
  }
}
