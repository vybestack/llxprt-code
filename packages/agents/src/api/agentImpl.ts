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

import type { UserTierId } from '@vybestack/llxprt-code-core/code_assist/types.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { getResponseText } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-core/telemetry/uiTelemetry.js';
import type {
  ApprovalMode,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
// @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
import { getToolKeyStorage } from '@vybestack/llxprt-code-core';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import {
  switchActiveProvider,
  setActiveModel,
  setActiveModelParam,
  clearActiveModelParam,
} from '@vybestack/llxprt-code-providers/runtime.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  AgentError,
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
} from './agent.js';
import type { AgentEvent } from './event-types.js';
import { mapLoopStream } from './eventAdapter.js';
import { ToolControl } from './control/toolControl.js';
import type { ToolControlDeps } from './control/toolControl.js';
import { McpControl } from './control/mcpControl.js';
import type { McpControlDeps } from './control/mcpControl.js';
// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
import { buildMcpControlDeps } from './control/mcpControlWiring.js';
import { AuthControl } from './control/authControl.js';
import { IdeControl } from './control/ideControl.js';
import type { IdeControlDeps } from './control/ideControl.js';
import { HookControl } from './control/hooks.js';
import type { HookControlDeps } from './control/hooks.js';
import { PolicyControl } from './control/policyControl.js';
import type { PolicyControlDeps } from './control/policyControl.js';
import { TasksControl } from './control/tasksControl.js';
import type { TasksControlDeps } from './control/tasksControl.js';
import { SessionControl } from './control/sessionControl.js';
import type { SessionControlDeps } from './control/sessionControl.js';
import { ProfilesControl } from './control/profilesControl.js';
import type { LoopHolder } from './loop/rebuildLoop.js';
import type { RebuildLoopDeps } from './loop/rebuildLoop.js';
import type {
  ApprovalHandler,
  DisplayCallbacks,
} from '../core/agenticLoop/types.js';
import {
  drainToResult,
  buildAgentResult,
  buildProviderInfos,
  buildToolInfos,
  toPartListUnion,
  type OwnershipRecord,
} from './agentBootstrap.js';
import type { EditorCallbacks } from './config-types.js';
import type { AgentAuth } from './config-types.js';
import type { OAuthPromptHandler } from './config-types.js';
import { createAgentAuthState } from './control/authState.js';
import type { AgentAuthState } from './control/authState.js';
import { computeAuthWinner } from './control/authState.js';
import type { AuthWinner } from './control/authState.js';
import type { AgentSchedulerHandle } from './config-types.js';

/**
 * Aggregate error thrown by {@link AgentImpl.dispose} when one or more teardown
 * steps fail. dispose() collects every failure into {@link errors} and throws
 * this AFTER attempting all cleanup, so a single failing resource never aborts
 * the rest of the teardown.
 * @plan:PLAN-20260617-COREAPI.P24
 * @requirement:REQ-016
 * @pseudocode dispose.md line 101
 */
export class AggregateDisposeError extends Error {
  readonly errors: readonly unknown[];

  constructor(errors: readonly unknown[]) {
    super(AggregateDisposeError.buildMessage(errors));
    this.name = 'AggregateDisposeError';
    this.errors = errors;
    Object.setPrototypeOf(this, AggregateDisposeError.prototype);
  }

  private static buildMessage(errors: readonly unknown[]): string {
    const details = errors
      .map((e) => (e instanceof Error ? e.message : String(e)))
      .join('; ');
    return `Agent dispose failed with ${errors.length} error(s): ${details}`;
  }
}

/**
 * The bootstrap dependency bundle injected into AgentImpl by buildAgent.
 * @pseudocode createAgent.md steps 150-160
 */
export interface AgentDeps {
  readonly config: Config;
  readonly providerManager: RuntimeProviderManager;
  readonly oauthManager: OAuthManager;
  readonly settingsService: SettingsService;
  readonly runtimeId: string;
  readonly runtimeHandle: {
    cleanup: () => Promise<void> | void;
  };
  readonly messageBus: MessageBus;
  readonly loopHolder: LoopHolder;
  readonly runtimeState: AgentRuntimeState;
  readonly ownership: OwnershipRecord;
  readonly rebuildLoop: (deps: RebuildLoopDeps) => unknown;
  readonly resolveClient: () => AgentClientContract;
  /**
   * The HistoryService instance createAgent eagerly created + stored for reuse
   * (storeHistoryServiceForReuse). Used as a fallback in the historyService
   * getter so the REQ-005 identity probe returns a non-null instance BEFORE
   * the chat is initialized (startChat runs lazily on the first turn). Because
   * transferHistoryToNewClient reuses the SAME stored instance across a
   * switch, this fallback keeps the before/after identity probe consistent.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-005
   */
  readonly initialHistoryService?: HistoryService;
  /**
   * The approvalHandler createAgent built (wrapApprovalHandler(onApproval)).
   * Threaded through so every P16 client-rebinding rebuild reuses it.
   * @plan:PLAN-20260617-COREAPI.P16
   */
  readonly approvalHandler?: ApprovalHandler;
  /**
   * The displayCallbacks createAgent built (deriveDisplayCallbacks).
   * Threaded through so every P16 client-rebinding rebuild reuses them.
   * @plan:PLAN-20260617-COREAPI.P16
   */
  readonly displayCallbacks?: DisplayCallbacks;
  readonly onOAuthPrompt?: unknown;
  readonly editorCallbacks?: EditorCallbacks;
  /**
   * The initial auth config threaded from createAgent (parsed.auth). Used to
   * seed the per-agent auth-state holder at construction.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  readonly initialAuth?: AgentAuth;
}

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
  readonly profiles: ProfilesControl;
  readonly tools: ToolControl;
  readonly mcp: McpControl;
  readonly auth: AuthControl;
  readonly ide: IdeControl;
  readonly session: SessionControl;
  readonly hooks: HookControl;
  readonly policy: PolicyControl;
  /** @plan:PLAN-20260622-COREAPIGAP.P08 @requirement:REQ-003 */
  readonly tasks: TasksControl;

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
   * `_unsubscribe` handle transition `function → undefined` after config.dispose()
   * disposes it (dispose.md line 60). The SAME instance dispose() tears down.
   * @plan:PLAN-20260617-COREAPI.P24
   * @requirement:REQ-016
   */
  readonly agentClient: AgentClientContract;

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
  private readonly authState: AgentAuthState;

  /**
   * Mutable editor-callbacks holder shared between ToolControl and the
   * scheduler factory. `agent.tools.setEditorCallbacks` writes here; the
   * rebuild-loop path reads it so the next turn's scheduler observes the
   * update (T3c reads getPreferredEditor()==='test-editor').
   * @plan:PLAN-20260617-COREAPI.P17
   * @requirement:REQ-006
   */
  private readonly editorCallbacksHolder: { editorCallbacks: EditorCallbacks };

  constructor(private readonly deps: AgentDeps) {
    this.ownership = deps.ownership;
    // @plan:PLAN-20260621-COREAPIREMED.P09 @requirement:REQ-001
    // Expose the providerManager + runtimeId so identity probes can assert the
    // adopted manager is the SAME instance (CRIT-1) and the runtime id is
    // deterministic (sessionId-derived).
    this.providerManager = deps.providerManager;
    this.runtimeId = deps.runtimeId;
    // @plan:PLAN-20260617-COREAPI.P24 @requirement:REQ-016
    // Expose the SAME shared MessageBus + Config-owned AgentClient + injected
    // scheduler/coordinator the facade owns so the T13 disposal probe reads the
    // genuine live objects dispose() tears down (no second bus, no clones).
    this.messageBus = deps.messageBus;
    this.agentClient = deps.config.getAgentClient();
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
    this.authState = createAgentAuthState();
    this.seedAuthState(rs.provider);
    // @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006
    // Shared mutable editor-callbacks holder seeded from createAgent's
    // editorCallbacks; ToolControl writes and the scheduler factory reads.
    this.editorCallbacksHolder = {
      editorCallbacks: deps.editorCallbacks ?? {},
    };
    const toolControlDeps: ToolControlDeps = {
      messageBus: deps.messageBus,
      config: deps.config,
      editorCallbacksHolder: this.editorCallbacksHolder,
      // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
      keysDeps: { getStorage: () => getToolKeyStorage() },
    };
    this.tools = new ToolControl(toolControlDeps);
    this.profiles = new ProfilesControl({
      getState: () => this.providerState,
      applySwitch: (provider, model) =>
        this.applyProviderSwitch(provider, model),
      applyParams: (params) => this.applyProfileParams(params),
      setKeyName: (keyName) => {
        this.providerState.keyName = keyName;
      },
      setLoadBalancer: (isLb) => {
        this.providerState.isLoadBalancer = isLb;
      },
      workingDir: deps.config.getTargetDir(),
    });
    this.auth = this.buildAuthControl();
    this.mcp = this.buildMcpControl();
    this.ide = this.buildIdeControl();
    this.session = this.buildSessionControl();
    this.hooks = this.buildHookControl();
    this.policy = this.buildPolicyControl();
    this.tasks = this.buildTasksControl();
  }

  /**
   * Builds the SessionControl wired to the live Config + per-agent session id,
   * resolveClient (the SAME restore path restoreHistory uses), and the
   * per-agent provider/model accessors, so checkpoint/recording/resume map onto
   * the real Logger / SessionRecordingService / resumeSession machinery.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private buildSessionControl(): SessionControl {
    const sessionDeps: SessionControlDeps = {
      config: this.deps.config,
      sessionId: () => this.deps.runtimeId,
      resolveClient: () => this.deps.resolveClient(),
      getProvider: () => this.providerState.provider,
      getModel: () => this.providerState.model,
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
    const hookDeps: HookControlDeps = {
      config: this.deps.config,
      messageBus: this.deps.messageBus,
      sessionId: () => this.deps.runtimeId,
      cwd: () => this.deps.config.getTargetDir(),
    };
    return new HookControl(hookDeps);
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
        const { updateActiveProviderApiKey } = await import(
          '@vybestack/llxprt-code-providers/runtime.js'
        );
        await updateActiveProviderApiKey(apiKey);
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
        const { updateActiveProviderBaseUrl } = await import(
          '@vybestack/llxprt-code-providers/runtime.js'
        );
        try {
          await updateActiveProviderBaseUrl(baseUrl ?? '');
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
   * Builds the McpControl wired to read the per-agent mcpAuth set plus the live
   * McpClientManager + tool registry so listServers/status/toolsByServer/
   * discoveryState/refresh project the REAL discovery surface.
   * @plan:PLAN-20260617-COREAPI.P22
   * @requirement:REQ-013
   */
  private buildMcpControl(): McpControl {
    // @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006 @pseudocode Dependencies/buildMcpControl
    const mcpDeps: McpControlDeps = buildMcpControlDeps({
      config: this.deps.config,
      isMcpAuthenticated: (server) => this.authState.mcpAuth.has(server),
      resolveClient: () => this.deps.resolveClient(),
    });
    return new McpControl(mcpDeps);
  }

  /**
   * Builds the IdeControl wired to the live IDE detection/connection surface
   * plus the SHARED editor-callbacks holder (the same holder
   * tools.setEditorCallbacks writes), so openEditor/closeEditor fire the
   * registered editor callbacks.
   * @plan:PLAN-20260617-COREAPI.P22
   * @requirement:REQ-014
   */
  private buildIdeControl(): IdeControl {
    const ideDeps: IdeControlDeps = {
      ideModeEnabled: () => this.deps.config.getIdeMode(),
      getEditorCallbacks: () => this.editorCallbacksHolder.editorCallbacks,
    };
    return new IdeControl(ideDeps);
  }

  /**
   * @plan:PLAN-20260622-COREAPIGAP.P06
   * @requirement:REQ-002
   */
  private buildPolicyControl(): PolicyControl {
    const policyDeps: PolicyControlDeps = {
      getEngine: () => this.deps.config.getPolicyEngine(),
    };
    return new PolicyControl(policyDeps);
  }

  /**
   * @plan:PLAN-20260622-COREAPIGAP.P08
   * @requirement:REQ-003
   */
  private buildTasksControl(): TasksControl {
    const tasksDeps: TasksControlDeps = {
      getManager: () => this.deps.config.getAsyncTaskManager(),
    };
    return new TasksControl(tasksDeps);
  }

  /**
   * Awaits MCP discovery readiness before a model turn (the discovery gate).
   * Returns a structured AgentError when discovery FAILED, or undefined when it
   * is ready/absent. `mcpDiscovery:'skip'` opts out (returns undefined without
   * awaiting). Non-blocking methods (mcp.status/discoveryState, listTools)
   * remain callable throughout.
   * @plan:PLAN-20260617-COREAPI.P22
   * @requirement:REQ-013
   */
  private async awaitMcpDiscoveryGate(
    opts?: TurnOptions,
  ): Promise<AgentError | undefined> {
    if (opts?.mcpDiscovery === 'skip') {
      return undefined;
    }
    const manager = this.deps.config.getMcpClientManager();
    if (manager === undefined) {
      return undefined;
    }
    await manager.whenDiscoverySettled();
    const failures = manager.getDiscoveryFailures();
    if (failures.size === 0) {
      return undefined;
    }
    const detail = Array.from(failures.entries())
      .map(([server, message]) => `${server}: ${message}`)
      .join('; ');
    return {
      code: 'mcp_discovery_failed',
      message: `MCP discovery failed (${detail})`,
    };
  }

  /**
   * Streams AgentEvents by delegating to the current loop's run().
   * @plan:PLAN-20260617-COREAPI.P15
   * @requirement:REQ-003
   * @pseudocode createAgent.md steps 130-148 (loop drives the turn)
   */
  async *stream(
    input: AgentInput,
    opts?: TurnOptions,
  ): AsyncIterable<AgentEvent> {
    // @plan:PLAN-20260617-COREAPI.P22 @requirement:REQ-013
    // MCP discovery gate: by default await readiness before the model turn. On
    // discovery FAILURE the stream yields exactly ONE done{reason:'error'} and
    // stops — no model turn runs.
    const gateError = await this.awaitMcpDiscoveryGate(opts);
    if (gateError !== undefined) {
      yield { type: 'done', reason: 'error' };
      return;
    }
    const loop = this.deps.loopHolder.current;
    if (loop === undefined) {
      throw new Error('Agent loop is not initialized');
    }
    const message = toPartListUnion(input);
    const signal =
      opts?.signal ?? this.deps.loopHolder.activeRunController?.signal;
    const effectiveSignal = signal ?? new AbortController().signal;
    const loopEvents = loop.run(message, effectiveSignal, opts?.promptId);
    const mapped = mapLoopStream(loopEvents);
    for await (const event of mapped) {
      // @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006
      // Tap the public stream so ToolControl fires onConfirmationRequest
      // (with details from the awaiting_approval ToolCall) and onToolUpdate
      // callbacks — driven from the SAME projection the eventAdapter produces.
      if (event.type === 'tool-confirmation') {
        this.tools.notifyConfirmation(event.confirmation);
      } else if (event.type === 'tool-status') {
        this.tools.notifyToolUpdate(event.update);
      }
      yield event;
    }
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
    // Run the MCP discovery gate once here so the buffered result surfaces the
    // typed AgentError{code:'mcp_discovery_failed'} (the stream error event
    // payload carries no code). On success the turn proceeds with the gate
    // already satisfied (skip re-awaiting inside stream()).
    const gateError = await this.awaitMcpDiscoveryGate(opts);
    if (gateError !== undefined) {
      return {
        text: '',
        toolCalls: [],
        finishReason: 'error',
        error: gateError,
      };
    }
    const drained = await drainToResult(
      this.stream(input, { ...opts, mcpDiscovery: 'skip' }),
    );
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
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @requirement:REQ-005
   * @pseudocode switch-rebind.md steps 30-42
   */
  async setProvider(provider: string, model?: string): Promise<void> {
    await this.applyProviderSwitch(provider, model);
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
    const s = this.providerState;
    const winner = this.computeWinner(s.provider);
    const keyNamePart =
      winner === 'keyName' && s.keyName !== undefined
        ? { keyName: s.keyName }
        : {};
    const keyFilePart =
      winner === 'keyfile' && this.authState.keyFile !== undefined
        ? { keyFile: this.authState.keyFile }
        : {};
    const baseUrlPart = s.baseUrl !== undefined ? { baseUrl: s.baseUrl } : {};
    return {
      provider: s.provider,
      model: s.model,
      authStatus: winner !== 'none' ? 'authenticated' : 'unauthenticated',
      ...baseUrlPart,
      ...keyNamePart,
      ...keyFilePart,
    };
  }

  /**
   * Returns the configured model per-agent (NOT the global runtime accessor).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   */
  getModel(): string {
    return this.providerState.model;
  }

  /**
   * Changes the active model (provider unchanged), preserving context.
   * setActiveModel does NOT rebuild, so config.initializeContentGeneratorConfig
   * is called explicitly, then rebuildLoop().
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @requirement:REQ-005
   * @pseudocode switch-rebind.md steps 50-60
   */
  async setModel(model: string): Promise<void> {
    await setActiveModel(model);
    await this.deps.config.initializeContentGeneratorConfig();
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
    const client = this.deps.resolveClient() as AgentClientContract | undefined;
    return client?.getCurrentSequenceModel() ?? null;
  }

  /**
   * @plan:PLAN-20260621-COREAPIREMED.P18
   * @requirement:REQ-005
   * @pseudocode lines 10-12
   */
  getRuntimeId(): string {
    return this.deps.runtimeId;
  }

  /** @plan:PLAN-20260621-COREAPIREMED.P09 @requirement:REQ-001 */
  getConfig(): Config {
    return this.deps.config;
  }

  /** @plan:PLAN-20260621-COREAPIREMED.P12 @requirement:REQ-002 @pseudocode lines 20-22 */
  getEphemeralSetting(key: string): unknown {
    return this.deps.config.getEphemeralSetting(key);
  }

  /** @plan:PLAN-20260621-COREAPIREMED.P12 @requirement:REQ-002 @pseudocode lines 30-33 */
  setEphemeralSetting(key: string, value: unknown): void {
    this.deps.config.setEphemeralSetting(key, value);
  }

  /** @plan:PLAN-20260621-COREAPIREMED.P12 @requirement:REQ-002 @pseudocode lines 40-42 */
  getEphemeralSettings(): Readonly<Record<string, unknown>> {
    return this.deps.config.getEphemeralSettings();
  }

  /**
   * @plan:PLAN-20260622-COREAPIGAP.P04
   * @requirement:REQ-001
   * @pseudocode lines 1-4
   */
  getApprovalMode(): ApprovalMode {
    return this.deps.config.getApprovalMode();
  }

  /**
   * @plan:PLAN-20260622-COREAPIGAP.P04
   * @requirement:REQ-001
   * @pseudocode lines 10-17
   */
  setApprovalMode(mode: ApprovalMode): void {
    this.deps.config.setApprovalMode(mode);
  }

  /**
   * Returns a readonly shallow snapshot of the per-agent model params.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @pseudocode switch-rebind.md steps 110-112
   */
  getModelParams(): Readonly<Record<string, unknown>> {
    return Object.freeze(
      Object.assign(
        Object.create(null) as Record<string, unknown>,
        this.providerState.modelParams,
      ),
    );
  }

  /**
   * Lazily sets a model param (no content-generator rebuild); the next provider
   * call reads it. Also updates the per-agent map so getModelParams reflects it.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @pseudocode switch-rebind.md steps 90-94
   */
  setModelParam(key: string, value: unknown): void {
    setActiveModelParam(key, value);
    this.providerState.modelParams[key] = value;
  }

  /**
   * Lazily clears a model param (no rebuild).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @pseudocode switch-rebind.md steps 100-103
   */
  clearModelParam(key: string): void {
    clearActiveModelParam(key);
    delete this.providerState.modelParams[key];
  }

  getUserTier(): UserTierId | undefined {
    return this.deps.resolveClient().getUserTier();
  }

  async getHistory(): Promise<readonly AgentMessage[]> {
    const client = this.deps.resolveClient();
    return client.getHistory();
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
    await client.restoreHistory([...items] as Parameters<
      typeof client.restoreHistory
    >[0]);
  }

  /**
   * Resets the chat: clears the live conversation history so the next turn runs
   * with no prior context. Delegates to the client's resetChat contract.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  async resetChat(): Promise<void> {
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
    const promptId = opts?.promptId ?? `compress-${Date.now()}`;
    // Ensure the chat is initialized before accessing it: setHistory can run
    // before the first turn (startChat is otherwise lazy on first turn).
    await this.restoreChatVisibility();
    const chat = this.deps.resolveClient().getChat();
    const originalTokenCount = this.readCompressionTokenCount();
    const raw = await chat.performCompression(promptId);
    if (raw === PerformCompressionResult.COMPRESSED) {
      const newTokenCount = this.readCompressionTokenCount();
      return {
        status: 'compressed',
        originalTokenCount: Math.max(originalTokenCount, newTokenCount),
        newTokenCount,
        promptId,
      };
    }
    const status: 'skipped' | 'failed' =
      raw === PerformCompressionResult.FAILED ? 'failed' : 'skipped';
    return { status, promptId };
  }

  /**
   * Returns a populated SessionStats snapshot projected from the in-process
   * uiTelemetryService singleton and the HistoryService. Every field is
   * guaranteed to be a number (defaulting to 0 via ?? 0).
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  getStats(): SessionStats {
    return this.projectStats();
  }

  /**
   * Subscribes to live SessionStats updates. Stats are sourced from the
   * uiTelemetryService 'update' event (fired during a stream turn). A single
   * immediate projection is also delivered at subscription time so callers are
   * guaranteed at least one stats frame even if no turn runs before the
   * subscription is torn down.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  onStats(cb: (stats: SessionStats) => void): Unsubscribe {
    const handler = (): void => {
      cb(this.projectStats());
    };
    cb(this.projectStats());
    uiTelemetryService.on('update', handler);
    return () => {
      uiTelemetryService.off('update', handler);
    };
  }

  /**
   * Side-channel single-shot generation. Delegates to the client's detached
   * direct-message path (generateDirectMessage), which does NOT append to the
   * conversation history and does NOT run a tool loop. Returns the response
   * text (empty string when the model emits no text part).
   * @plan:PLAN-20260617-COREAPI.P21
   * @requirement:REQ-012
   */
  async generate(input: AgentInput, opts?: GenerateOptions): Promise<string> {
    const client = this.deps.resolveClient();
    const message = toPartListUnion(input);
    const promptId = opts?.promptId ?? `generate-${Date.now()}`;
    const response = await client.generateDirectMessage({ message }, promptId);
    return getResponseText(response) ?? '';
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
    const client = this.deps.resolveClient();
    const contentsArr = [...contents] as Parameters<
      typeof client.generateJson
    >[0];
    const signal = opts?.signal ?? new AbortController().signal;
    const model = opts?.model ?? this.providerState.model;
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
    const client = this.deps.resolveClient();
    return client.generateEmbedding([...texts]);
  }

  /**
   * Returns a concrete ProviderInfo[] from the runtime provider manager.
   * @plan:PLAN-20260617-COREAPI.P15
   * @requirement:REQ-017
   */
  listProviders(): readonly ProviderInfo[] {
    const names = this.deps.providerManager.listProviders();
    const configured = new Set(names);
    return buildProviderInfos(names, configured);
  }

  /**
   * Returns a concrete ToolInfo[] from the tool registry.
   * @plan:PLAN-20260617-COREAPI.P15
   * @requirement:REQ-017
   */
  listTools(): readonly ToolInfo[] {
    const registry = this.deps.config.getToolRegistry();
    const allTools = registry.getAllTools().map((t) => ({
      name: t.name,
      serverName: (t as { serverName?: string }).serverName,
    }));
    const enabledNames = new Set(registry.getEnabledTools().map((t) => t.name));
    return buildToolInfos(allTools, enabledNames);
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

  // ─── P20 stats/compression projection helpers ────────────────────────────

  /**
   * Projects the in-process uiTelemetryService singleton metrics + HistoryService
   * into the public SessionStats shape. Token fields are summed across per-model
   * metrics, falling back to tokenTracking.sessionTokenUsage when the per-model
   * sums are zero; contextWindowUsed reads uiTelemetryService.getLastPromptTokenCount();
   * turnCount is derived from the HistoryService message count when reachable.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private projectStats(): SessionStats {
    const metrics = uiTelemetryService.getMetrics();
    let promptTokens = 0;
    let candidateTokens = 0;
    let totalTokens = 0;
    let cachedTokens = 0;
    for (const modelName of Object.keys(metrics.models)) {
      const t = metrics.models[modelName].tokens;
      promptTokens += t.prompt;
      candidateTokens += t.candidates;
      totalTokens += t.total;
      cachedTokens += t.cached;
    }
    const sessionUsage = metrics.tokenTracking.sessionTokenUsage;
    const promptTokensFinal =
      promptTokens > 0 ? promptTokens : sessionUsage.input;
    const candidateTokensFinal =
      candidateTokens > 0 ? candidateTokens : sessionUsage.output;
    const totalTokensFinal = totalTokens > 0 ? totalTokens : sessionUsage.total;
    const cachedTokensFinal =
      cachedTokens > 0 ? cachedTokens : sessionUsage.cache;
    return {
      promptTokens: promptTokensFinal,
      candidateTokens: candidateTokensFinal,
      totalTokens: totalTokensFinal,
      cachedTokens: cachedTokensFinal,
      contextWindowSize: 0,
      contextWindowUsed: uiTelemetryService.getLastPromptTokenCount(),
      turnCount: this.readTurnCount(),
    };
  }

  /**
   * Reads a defensive token count from the HistoryService for compression
   * before/after snapshots. Returns 0 when the HistoryService is unavailable.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-011
   */
  private readCompressionTokenCount(): number {
    const service = this.historyService;
    if (service === null) {
      return 0;
    }
    try {
      return service.getTotalTokens();
    } catch {
      return 0;
    }
  }

  /**
   * Reads the conversation turn/message count from the HistoryService. Returns 0
   * when the HistoryService is unavailable.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private readTurnCount(): number {
    const service = this.historyService;
    if (service === null) {
      return 0;
    }
    try {
      return service.getStatistics().totalMessages;
    } catch {
      return 0;
    }
  }

  // ─── P16 switch/context-preservation helpers ─────────────────────────────

  /**
   * Core provider(+optional model) switch used by both setProvider and
   * profiles.apply. switchActiveProvider rebuilds the content generator
   * internally (try/catch for the fake seam where the named provider is not
   * registered). When a model is supplied, setActiveModel + the explicit
   * model-only rebuild. Then rebuildLoop(). Updates the per-agent state holder.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @requirement:REQ-005
   * @pseudocode switch-rebind.md steps 30-42
   */
  private async applyProviderSwitch(
    provider: string,
    model?: string,
  ): Promise<void> {
    // switchActiveProvider rebuilds the content generator internally; under the
    // fake seam the named provider is not registered and this throws (no-op).
    let providerChanged = false;
    try {
      await switchActiveProvider(provider);
      providerChanged = true;
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
        await setActiveModel(model);
        await this.deps.config.initializeContentGeneratorConfig();
      }
      await this.restoreChatVisibility();
    }
    // Under the fake seam (providerChanged === false), the client is unchanged;
    // history/HistoryService identity is trivially preserved (same client).
    this.providerState.provider = provider;
    if (model !== undefined) {
      this.providerState.model = model;
    }
    this.rebuild();
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
  private async restoreChatVisibility(): Promise<void> {
    const client = this.deps.resolveClient();
    if (!client.hasChatInitialized()) {
      const carriedHistory = await client.getHistory();
      await client.startChat(
        carriedHistory.length > 0 ? carriedHistory : undefined,
      );
    }
  }

  /**
   * Applies a profile's modelParams onto the live agent via the lazy runtime
   * mutators and updates the per-agent map (used by profiles.apply).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-009
   * @pseudocode switch-rebind.md steps 90-94
   */
  private applyProfileParams(params: Readonly<Record<string, unknown>>): void {
    for (const [key, value] of Object.entries(params)) {
      setActiveModelParam(key, value);
      this.providerState.modelParams[key] = value;
    }
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
      loopHolder: this.deps.loopHolder,
      resolveClient: this.deps.resolveClient,
      config: this.deps.config,
      messageBus: this.deps.messageBus,
      ...(this.deps.approvalHandler !== undefined
        ? { approvalHandler: this.deps.approvalHandler }
        : {}),
      ...(this.deps.displayCallbacks !== undefined
        ? { displayCallbacks: this.deps.displayCallbacks }
        : {}),
    });
  }

  /**
   * Computes the auth status for an explicit provider.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  private computeAuthStatusForProvider(provider: string): AuthStatus {
    const winner = this.computeWinner(provider);
    return winner !== 'none' ? 'authenticated' : 'unauthenticated';
  }

  /**
   * Computes the REQ-008 precedence winner for a provider.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
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
   *   60    config.dispose() (agentClient + mcpClientManager)
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
  async dispose(): Promise<void> {
    const ownership = this.ownership;
    // @pseudocode dispose.md 11-13: idempotency guard.
    if (ownership.disposed) {
      return;
    }
    ownership.disposed = true;
    // @pseudocode dispose.md 14: error accumulator (collect, never short-circuit).
    const errors: unknown[] = [];
    const holder = this.deps.loopHolder;

    // @pseudocode dispose.md 20: REQ-015 SessionEnd-on-dispose lifecycle hook.
    await this.safe(errors, () => this.hooks.triggerSessionEnd());

    // @pseudocode dispose.md 30: abort the facade-owned active-run controller
    // (its .signal was passed to loop.run; AgenticLoop self-cleans in finally).
    await this.safe(errors, () => {
      holder.activeRunController?.abort();
    });

    // @pseudocode dispose.md 40-47: CONDITIONAL T19 teardown. Dispose every
    // scheduler handle created via the caller-injected toolSchedulerFactory and
    // retained by the facade. Each handle backs BOTH the conceptual scheduler
    // (40-42) and coordinator (45-47) rows — the injected recording fake exposes
    // a single handle whose `disposed` flag covers both — so each is disposed
    // exactly ONCE here (no double-dispose). The caller-owned factory FUNCTION is
    // never disposed. Per-turn loop schedulers stay owned + disposed by
    // AgenticLoop (config.disposeScheduler) — dispose() does NOT touch them. A
    // failing handle's rejection is collected into errors → AggregateDisposeError.
    for (const handle of ownership.injectedSchedulerHandles) {
      await this.safe(errors, () => handle.dispose());
    }

    // @pseudocode dispose.md 50-52: unsubscribe every recorded bus subscription
    // and detach the hooks control's shared-MessageBus subscriptions, driving
    // the bus emitter's listener tally to its post-dispose baseline (zero).
    this.safeSync(errors, () => {
      this.hooks.detach();
    });
    const subs = holder.subscriptions;
    if (subs !== undefined) {
      for (const unsubscribe of subs) {
        this.safeSync(errors, () => {
          unsubscribe();
        });
      }
    }

    // @pseudocode dispose.md 55: runtimeHandle.cleanup() unregisters the runtime
    // context (and tears down OAuth infra within).
    await this.safe(errors, () => this.deps.runtimeHandle.cleanup());

    // @pseudocode dispose.md 60: config.dispose() disposes agentClient
    // (_unsubscribe → undefined) and stops mcpClientManager.
    // @plan:PLAN-20260621-COREAPIREMED.P09 @requirement:REQ-001.3
    // SKIP when the Config is caller-owned (fromConfig): the caller retains the
    // Config lifecycle and disposes it. An agent-owned Config (createAgent) is
    // torn down here as before.
    if (ownership.configOwnership !== 'caller') {
      await this.safe(errors, () => this.deps.config.dispose());
    }

    // @pseudocode dispose.md 70: NET-NEW LSP shutdown wiring. shutdownLspService
    // exists on Config but Config.dispose() does not call it; wire it here and
    // set the completion marker AFTER the await succeeds (T13 observable).
    // @plan:PLAN-20260621-COREAPIREMED.P09 @requirement:REQ-001.3
    // SKIP the caller-owned Config's LSP service too (the caller owns it).
    if (ownership.configOwnership !== 'caller') {
      await this.safe(errors, async () => {
        await this.deps.config.shutdownLspService();
        ownership.lspShutDown = true;
      });
    }

    // @plan:PLAN-20260617-COREAPI.P24 @requirement:REQ-016
    // @pseudocode dispose.md 80: NET-NEW extensions teardown. The pseudocode's
    // `extensionsManager.dispose()` does not exist; the real Config-owned seam is
    // the ExtensionLoader reachable via ownership.config.getExtensionLoader().
    // Tear down every active extension via its documented dynamic-unload path
    // (ExtensionLoader.unloadExtension), collecting any failing unload into
    // errors[] via safe(), then set the completion marker AFTER the awaited loop
    // (T13 observable). Headless agents have zero active extensions, so the loop
    // is vacuously empty while remaining a genuine awaited teardown call-path.
    const activeExtensions = collectActiveExtensions(
      ownership.config.getExtensionLoader(),
    );
    for (const extension of activeExtensions) {
      await this.safe(errors, () =>
        unloadExtensionSafely(ownership.config.getExtensionLoader(), extension),
      );
    }
    ownership.extensionsDisposed = true;

    // @pseudocode dispose.md 81-83: NET-NEW session-lock release. Release every
    // facade-owned lock, then set the completion marker AFTER the loop completes
    // (vacuously true with zero locks in headless mode; T13 observable).
    for (const lock of ownership.sessionLocks) {
      await this.safe(errors, () => lock.release());
    }
    ownership.sessionLocksReleased = true;

    // @pseudocode dispose.md 81-83 (REQ-010): release SessionControl-owned
    // resources — the active recording service and the on-disk session lock a
    // resume acquired — so neither leaks past agent teardown. Guarded via safe()
    // so a failing release is collected into errors[] rather than swallowed.
    await this.safe(errors, () => this.session.dispose());

    // @pseudocode dispose.md 90-92: defensive OAuth teardown (runtimeHandle.cleanup
    // at line 55 should already have disposed it).
    await this.safe(errors, () => disposeOAuthManager(this.deps.oauthManager));

    // @pseudocode dispose.md 100-102: surface collected failures (do not swallow).
    if (errors.length > 0) {
      throw new AggregateDisposeError(errors);
    }
  }

  /**
   * Awaits fn and pushes any throw/rejection into the errors accumulator so the
   * teardown continues. Never rethrows mid-teardown.
   * @plan:PLAN-20260617-COREAPI.P24
   * @requirement:REQ-016
   * @pseudocode dispose.md 110-113
   */
  private async safe(
    errors: unknown[],
    fn: () => Promise<void> | void,
  ): Promise<void> {
    try {
      await fn();
    } catch (e: unknown) {
      errors.push(e);
    }
  }

  /**
   * Synchronous variant of {@link safe} for non-awaitable teardown steps
   * (unsubscribe / detach). Pushes any throw into the errors accumulator.
   * @plan:PLAN-20260617-COREAPI.P24
   * @requirement:REQ-016
   * @pseudocode dispose.md 110-113
   */
  private safeSync(errors: unknown[], fn: () => void): void {
    try {
      fn();
    } catch (e: unknown) {
      errors.push(e);
    }
  }
}

/**
 * Defensively disposes an OAuthManager if it exposes a dispose method. The
 * runtime context cleanup (dispose.md line 55) normally owns this teardown; this
 * guard covers managers that are not torn down there.
 * @plan:PLAN-20260617-COREAPI.P24
 * @requirement:REQ-016
 * @pseudocode dispose.md 90-92
 */
async function disposeOAuthManager(manager: OAuthManager): Promise<void> {
  const holder = manager as unknown as {
    dispose?: () => Promise<void> | void;
  };
  if (typeof holder.dispose === 'function') {
    await holder.dispose();
  }
}

/**
 * Structural view of the Config-owned extension loader's teardown surface. The
 * real ExtensionLoader (core/utils/extensionLoader.ts) exposes both methods;
 * this optional-method shape mirrors the disposeOAuthManager runtime-guard idiom
 * so a loader that does not surface them is skipped rather than crashing.
 * @plan:PLAN-20260617-COREAPI.P24
 * @requirement:REQ-016
 */
interface ExtensionTeardownSurface {
  getExtensions?: () => GeminiCLIExtension[];
  unloadExtension?: (extension: GeminiCLIExtension) => Promise<void> | void;
}

/**
 * Returns the active extensions known to the Config-owned loader. Defensively
 * guards the loader's getExtensions surface (mirroring disposeOAuthManager) and
 * filters to active extensions, since only active ones have started teardownable
 * MCP servers/context/commands/subagents (dispose.md line 80).
 * @plan:PLAN-20260617-COREAPI.P24
 * @requirement:REQ-016
 * @pseudocode dispose.md 80
 */
function collectActiveExtensions(loader: unknown): GeminiCLIExtension[] {
  const surface = loader as ExtensionTeardownSurface;
  if (typeof surface.getExtensions !== 'function') {
    return [];
  }
  return surface.getExtensions().filter((extension) => extension.isActive);
}

/**
 * Unloads a single extension through the loader's documented dynamic-unload path
 * (ExtensionLoader.unloadExtension), which stops the extension's MCP servers,
 * context, custom commands, and subagents. Defensively guards the unloadExtension
 * surface (mirroring disposeOAuthManager). A thrown unload propagates so the
 * caller's safe() collects it into errors[] (dispose.md line 80).
 * @plan:PLAN-20260617-COREAPI.P24
 * @requirement:REQ-016
 * @pseudocode dispose.md 80
 */
async function unloadExtensionSafely(
  loader: unknown,
  extension: GeminiCLIExtension,
): Promise<void> {
  const surface = loader as ExtensionTeardownSurface;
  if (typeof surface.unloadExtension === 'function') {
    await surface.unloadExtension(extension);
  }
}

/**
 * Type guard narrowing the unknown onOAuthPrompt dep to OAuthPromptHandler.
 * The AgentConfigSchema guarantees the shape when present; this guard avoids
 * an unsafe cast.
 * @plan:PLAN-20260617-COREAPI.P18
 * @requirement:REQ-008
 */
function isOAuthPromptHandler(v: unknown): v is OAuthPromptHandler {
  return typeof v === 'function';
}

/**
 * Factory that injects bootstrap deps into AgentImpl.
 * @pseudocode createAgent.md steps 150-160
 */
export function buildAgent(deps: AgentDeps): Agent {
  return new AgentImpl(deps);
}
