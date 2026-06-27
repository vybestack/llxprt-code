/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P15
 * @requirement:REQ-001
 * @requirement:REQ-003
 * @pseudocode createAgent.md steps 10-176
 */

import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { createIsolatedRuntimeContext } from '@vybestack/llxprt-code-providers/runtime.js';
import type { IsolatedRuntimeContextHandle } from '@vybestack/llxprt-code-providers/runtime.js';
import {
  switchActiveProvider,
  setActiveModel,
  updateActiveProviderApiKey,
  updateActiveProviderBaseUrl,
  getActiveProviderName,
  getActiveModelName,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { createProviderManager } from '@vybestack/llxprt-code-providers/composition.js';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { ToolSchedulerFactory } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  AgentConfig,
  AgentSchedulerHandle,
  EditorCallbacks,
} from './config-types.js';
import type { AgentAuth } from './config-types.js';
import type { Agent } from './agent.js';
import { AgentConfigSchema } from './config-schema.js';
import { toConfigParameters } from './agentConfig.adapter.js';
import { AgenticLoop } from '../core/agenticLoop/AgenticLoop.js';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
import {
  wrapRegistryWithConfirmation,
  injectConfirmationForcingPolicy,
} from './confirmationForcing.js';
import {
  rebuildLoop,
  createLoopHolder,
  type LoopHolder,
} from './loop/rebuildLoop.js';
import { buildAgent } from './agentImpl.js';
import {
  resolveAuthType,
  generateRuntimeId,
  buildAgentClientFactory,
  wrapSchedulerFactory,
  wrapApprovalHandler,
  deriveDisplayCallbacks,
  recordOwnership,
  AgentBootstrapError,
} from './agentBootstrap.js';

/**
 * Builds a ready Agent by composing shipped primitives through a shared runtime
 * context with a single shared MessageBus.
 * @pseudocode createAgent.md steps 10-176
 */
export async function createAgent(rawConfig: AgentConfig): Promise<Agent> {
  // @pseudocode createAgent.md steps 10-13: validate config, resolve auth, runtimeId
  // STRICT-SCHEMA HAZARD: destructure callbacks off the input BEFORE parsing —
  // AgentConfigSchema is .strict() and rejects function-typed fields.
  const {
    onApproval,
    onOAuthPrompt,
    editorCallbacks,
    toolSchedulerFactory,
    ...validatable
  } = rawConfig;
  const parsed = AgentConfigSchema.parse(validatable);
  const resolvedAuth = resolveAuthType(parsed.auth);
  const runtimeId = parsed.sessionId ?? generateRuntimeId();

  // @pseudocode createAgent.md steps 20-27: ConfigParameters + factory injection
  const agentClientFactory = buildAgentClientFactory();
  const frozenParams = toConfigParameters(parsed as unknown as AgentConfig);
  // toConfigParameters returns a frozen object; create a mutable shallow copy
  // to inject the agentClientFactory and optional toolSchedulerFactory.
  const params = { ...frozenParams };
  params.agentClientFactory = agentClientFactory;
  // @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-006 @requirement:REQ-016
  const forceConfirmations = applyHarnessGates(parsed, params);
  // Registry of scheduler handles created via a caller-injected factory. The
  // facade retains these and Agent.dispose() tears them down (dispose.md lines
  // 40-47). Empty unless a toolSchedulerFactory was supplied.
  const injectedSchedulerHandles: AgentSchedulerHandle[] = [];
  // @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006
  // DEFAULT scheduler factory: construct a CoreToolScheduler. The harness gate
  // decides whether the registry is wrapped so every tool surfaces a REAL
  // confirmation. Without a factory, Config.getOrCreateScheduler throws
  // "toolSchedulerFactory is required".
  const defaultSchedulerFactory = createDefaultToolSchedulerFactory({
    forceConfirmations,
  });
  if (toolSchedulerFactory !== undefined) {
    // @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-006 @requirement:REQ-016
    // The caller injected a factory: each per-turn scheduler is still a real,
    // functioning CoreToolScheduler (built by defaultSchedulerFactory), while
    // the injected factory is invoked alongside and the handle it returns is
    // retained for facade-level disposal. The injected factory FUNCTION is
    // never disposed — only the handle instances it creates.
    params.toolSchedulerFactory = wrapSchedulerFactory(
      toolSchedulerFactory,
      defaultSchedulerFactory,
      injectedSchedulerHandles,
    );
  } else {
    params.toolSchedulerFactory = defaultSchedulerFactory;
  }
  // @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006
  // @plan:PLAN-20260626-RUNTIMEBOUNDARY.P01
  // Forced confirmations require an interactive runtime; otherwise ASK_USER is
  // converted to DENY before the confirmation coordinator can prompt.

  // @pseudocode createAgent.md steps 30-38: construct Config + ONE shared MessageBus
  const config = new Config(params);
  // @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006
  // @plan:PLAN-20260626-RUNTIMEBOUNDARY.P01
  // @pseudocode tool-confirmation-merge.md steps 10-31 (policy-ASK seam)
  // Ensure the process working directory is a valid workspace root so that
  // fixture paths using {{CWD}} (expanded by FakeProvider to process.cwd())
  // resolve within the workspace boundary and do not fail tool build
  // validation (ReadFileTool.validatePathWithinWorkspace). Without this, a
  // workingDir narrower than process.cwd() would reject valid paths.
  //
  // The harness.includeProcessCwd gate (default true) lets production callers
  // avoid mutating the workspace with process.cwd() when they supply their own
  // workingDir.
  const includeProcessCwd = parsed.harness?.includeProcessCwd ?? true;
  if (includeProcessCwd) {
    config.getWorkspaceContext().addDirectory(process.cwd());
  }
  // Inject a high-priority ASK policy rule that overrides the read-only.toml
  // ALLOW rules (priority 1.050) for ALL tools. This forces the
  // ConfirmationCoordinator's tryFastApprove to fall through (ASK is neither
  // ALLOW nor DENY), so evaluateAndRoute runs and reaches
  // shouldConfirmExecute — the confirmation-forcing seam returns truthy
  // info-details, setupConfirmationPrompt publishes a real
  // TOOL_CONFIRMATION_REQUEST, and the awaiting_approval ToolCall carries
  // confirmationDetails (satisfying T2b/T3c/T11). Priority 4.0 sits above
  // every TOML tier (1.x/2.x/3.x) and all settings bands, so it cannot be
  // overridden by user/admin policy either.
  //
  // The harness.forceConfirmations gate (default true) lets production callers
  // skip the policy injection when they do not want forced confirmations.
  if (forceConfirmations) {
    injectConfirmationForcingPolicy(config.getPolicyEngine());
  }
  const messageBus = new MessageBus(
    config.getPolicyEngine(),
    config.getDebugMode(),
  );
  const settingsService = config.getSettingsService();

  // @pseudocode createAgent.md steps 41-58
  // SHARED runtime context — adopts OUR Config/MessageBus. DO NOT pass
  // provider/apiKey/baseUrl (they are not valid options; applied via mutators
  // after activation). The prepare callback registers providers (including
  // FakeProvider under LLXPRT_FAKE_RESPONSES) onto the isolated manager.
  const handle: IsolatedRuntimeContextHandle = createIsolatedRuntimeContext({
    runtimeId,
    settingsService,
    config,
    model: parsed.model,
    messageBus,
    prepare: (ctx) => {
      registerProvidersOntoManager(ctx.providerManager, ctx, ctx.config);
    },
  });
  const manager = handle.providerManager;
  const oauthManager = handle.oauthManager;
  const sharedSettingsService = handle.settingsService;

  // @pseudocode createAgent.md step 57-58: ACTIVATE (ASYNC — must be awaited)
  await handle.activate();

  // @pseudocode createAgent.md steps 61-79: apply provider/model/auth via real mutators
  await applyInitialProviderModelAuth(parsed, resolvedAuth, config);

  // @pseudocode createAgent.md step 81-82: initialize (creates transient pre-auth client)
  await config.initialize({ messageBus });

  // @pseudocode createAgent.md step 95-96: refreshAuth (creates post-auth client)
  await config.refreshAuth(resolvedAuth.authMethod);

  // @pseudocode createAgent.md steps 105-166: finalize agent (runtime state,
  // client bind, loop build, ownership, facade, session-start hook)
  return finalizeAgent(
    parsed,
    resolvedAuth,
    config,
    manager,
    oauthManager,
    sharedSettingsService,
    runtimeId,
    handle,
    messageBus,
    onApproval,
    onOAuthPrompt,
    editorCallbacks,
    injectedSchedulerHandles,
    'agent',
  );
}

/**
 * Finalizes the agent after the runtime context is active and authenticated.
 * Builds the runtime state, binds the post-auth client, constructs the initial
 * loop, records ownership, builds the facade, and fires the SessionStart hook.
 * Exported so {@link fromConfig} reuses the SAME finalize path (CRIT-4:
 * single source of finalize — no parallel copy).
 * @pseudocode createAgent.md steps 105-166
 */
export async function finalizeAgent(
  parsed: {
    readonly provider: string;
    readonly model: string;
    readonly modelParams?: Readonly<Record<string, unknown>>;
    readonly sessionId?: string;
    readonly auth?: AgentAuth;
  },
  resolvedAuth: {
    readonly baseUrl: string | undefined;
  },
  config: Config,
  manager: RuntimeProviderManager,
  oauthManager: OAuthManager,
  sharedSettingsService: SettingsService,
  runtimeId: string,
  handle: IsolatedRuntimeContextHandle,
  messageBus: MessageBus,
  onApproval: Parameters<typeof wrapApprovalHandler>[0] | undefined,
  onOAuthPrompt: unknown,
  editorCallbacks: EditorCallbacks | undefined,
  injectedSchedulerHandles: AgentSchedulerHandle[],
  // @plan:PLAN-20260621-COREAPIREMED.P09 @requirement:REQ-001,REQ-006 @requirement:REQ-001.3
  // Threading the config ownership origin so dispose() can skip tearing down a
  // caller-owned Config (fromConfig) while still tearing down an agent-owned
  // Config (createAgent).
  configOwnership: 'agent' | 'caller',
): Promise<Agent> {
  // @pseudocode createAgent.md steps 105-113: runtime state (runtimeId REQUIRED)
  const runtimeState = createAgentRuntimeState({
    runtimeId,
    provider: parsed.provider,
    model: parsed.model,
    baseUrl: resolvedAuth.baseUrl,
    modelParams: parsed.modelParams,
    sessionId: parsed.sessionId,
  });

  // @pseudocode createAgent.md steps 115-118: bind POST-auth client
  const client = config.getAgentClient() as AgentClientContract | undefined;
  if (client === undefined) {
    throw new AgentBootstrapError('no post-auth agent client');
  }

  // Eagerly create + store a HistoryService for reuse so a non-null identity is
  // available from creation (REQ-005); the chat stays lazy (startChat on the
  // first turn) and createChatSessionSafe reuses this stored instance.
  const initialHistoryService = new HistoryService();
  client.storeHistoryServiceForReuse(initialHistoryService);

  // @pseudocode createAgent.md steps 130-148: build the initial loop via rebuildLoop
  const loopHolder: LoopHolder = createLoopHolder();
  const resolveClient = () => config.getAgentClient();
  const approvalHandler =
    onApproval !== undefined ? wrapApprovalHandler(onApproval) : undefined;
  const displayCallbacks = deriveDisplayCallbacks(editorCallbacks);
  rebuildLoop({
    loopHolder,
    resolveClient,
    config,
    messageBus,
    ...(approvalHandler !== undefined ? { approvalHandler } : {}),
    ...(displayCallbacks !== undefined ? { displayCallbacks } : {}),
    AgenticLoopCtor: AgenticLoop,
  });

  // @pseudocode createAgent.md steps 150-166: ownership + facade + SessionStart
  return assembleFacade({
    config,
    manager,
    oauthManager,
    sharedSettingsService,
    runtimeId,
    handle,
    messageBus,
    loopHolder,
    runtimeState,
    resolveClient,
    initialHistoryService,
    approvalHandler,
    displayCallbacks,
    onOAuthPrompt,
    editorCallbacks,
    initialAuth: parsed.auth,
    injectedSchedulerHandles,
    configOwnership,
  });
}

/**
 * Deps bundle for {@link assembleFacade}: the post-loop facade construction
 * inputs threaded out of finalizeAgent to keep that function within the
 * per-function line budget.
 * @pseudocode createAgent.md steps 150-160
 */
interface AssembleFacadeDeps {
  readonly config: Config;
  readonly manager: RuntimeProviderManager;
  readonly oauthManager: OAuthManager;
  readonly sharedSettingsService: SettingsService;
  readonly runtimeId: string;
  readonly handle: IsolatedRuntimeContextHandle;
  readonly messageBus: MessageBus;
  readonly loopHolder: LoopHolder;
  readonly runtimeState: ReturnType<typeof createAgentRuntimeState>;
  readonly resolveClient: () => ReturnType<Config['getAgentClient']>;
  readonly initialHistoryService: HistoryService;
  readonly approvalHandler: ReturnType<typeof wrapApprovalHandler> | undefined;
  readonly displayCallbacks: ReturnType<typeof deriveDisplayCallbacks>;
  readonly onOAuthPrompt: unknown;
  readonly editorCallbacks: EditorCallbacks | undefined;
  readonly initialAuth: AgentAuth | undefined;
  readonly injectedSchedulerHandles: AgentSchedulerHandle[];
  /**
   * The config ownership origin. 'agent' when createAgent constructed the
   * Config (dispose() tears it down); 'caller' when fromConfig adopted an
   * external Config (dispose() skips it).
   * @plan:PLAN-20260621-COREAPIREMED.P09
   * @requirement:REQ-001.3
   */
  readonly configOwnership: 'agent' | 'caller';
}

/**
 * Records ownership, builds the public Agent facade, and fires the SessionStart
 * lifecycle hook. Extracted from finalizeAgent so each function stays within the
 * per-function line budget without changing behavior.
 * @plan:PLAN-20260617-COREAPI.P23
 * @requirement:REQ-015
 * @pseudocode createAgent.md steps 150-166
 */
async function assembleFacade(deps: AssembleFacadeDeps): Promise<Agent> {
  const ownership = recordOwnership({
    runtimeHandle: deps.handle,
    config: deps.config,
    messageBus: deps.messageBus,
    loopHolder: deps.loopHolder,
    runtimeState: deps.runtimeState,
    injectedSchedulerHandles: deps.injectedSchedulerHandles,
    configOwnership: deps.configOwnership,
  });
  const agent = buildAgent({
    config: deps.config,
    providerManager: deps.manager,
    oauthManager: deps.oauthManager,
    settingsService: deps.sharedSettingsService,
    runtimeId: deps.runtimeId,
    runtimeHandle: deps.handle,
    messageBus: deps.messageBus,
    loopHolder: deps.loopHolder,
    runtimeState: deps.runtimeState,
    ownership,
    rebuildLoop,
    resolveClient: deps.resolveClient,
    initialHistoryService: deps.initialHistoryService,
    ...(deps.approvalHandler !== undefined
      ? { approvalHandler: deps.approvalHandler }
      : {}),
    ...(deps.displayCallbacks !== undefined
      ? { displayCallbacks: deps.displayCallbacks }
      : {}),
    onOAuthPrompt: deps.onOAuthPrompt,
    editorCallbacks: deps.editorCallbacks,
    ...(deps.initialAuth !== undefined
      ? { initialAuth: deps.initialAuth }
      : {}),
  });

  // @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-015
  // @pseudocode createAgent.md steps 165-166: fire SessionStart now that the
  // facade is built (observable via agent.hooks.onHookExecution; safe when
  // hooks are off — the core lifecycle trigger short-circuits).
  await agent.hooks.triggerSessionStart();
  return agent;
}

function applyHarnessGates(
  parsed: { readonly harness?: AgentConfig['harness'] },
  params: { interactive?: boolean },
): boolean {
  const forceInteractive = parsed.harness?.forceInteractive ?? true;
  if (forceInteractive) {
    params.interactive = true;
  }
  return (
    (parsed.harness?.forceConfirmations ?? true) && params.interactive !== false
  );
}

/**
 * Applies the initial provider, model, and auth fields through the real runtime
 * mutators after the context is active.
 * @pseudocode createAgent.md steps 61-79
 */
async function applyInitialProviderModelAuth(
  parsed: {
    readonly provider: string;
    readonly model: string;
  },
  resolvedAuth: {
    readonly apiKey: string | undefined;
    readonly baseUrl: string | undefined;
  },
  config: Config,
): Promise<void> {
  const activeProvider = safeActiveProviderName();
  if (parsed.provider !== activeProvider) {
    // switchActiveProvider rebuilds the content generator internally; NO model arg.
    // Under LLXPRT_FAKE_RESPONSES only FakeProvider is registered; switching to a
    // named provider that is not registered is a no-op (the active FakeProvider
    // handles all requests). This is the intended fake-seam behavior.
    try {
      await switchActiveProvider(parsed.provider);
    } catch {
      // Provider not registered (e.g. fake mode) — continue with the active provider.
    }
  }
  const activeModel = safeActiveModelName();
  if (parsed.model !== activeModel) {
    // setActiveModel does NOT rebuild — explicit initializeContentGeneratorConfig required.
    await setActiveModel(parsed.model);
    await config.initializeContentGeneratorConfig();
  }
  if (resolvedAuth.apiKey !== undefined) {
    await updateActiveProviderApiKey(resolvedAuth.apiKey);
  }
  if (resolvedAuth.baseUrl !== undefined) {
    await updateActiveProviderBaseUrl(resolvedAuth.baseUrl);
  }
}

/** Reads the active provider name without throwing when unset. */
function safeActiveProviderName(): string {
  try {
    return getActiveProviderName();
  } catch {
    return '';
  }
}

/** Reads the active model name without throwing when unset. */
function safeActiveModelName(): string {
  try {
    return getActiveModelName();
  } catch {
    return '';
  }
}

/**
 * Registers providers onto the isolated context's ProviderManager. Uses
 * createProviderManager (from composition) to build a fully-registered manager
 * and transfers all registered provider names + their provider instances onto
 * the isolated manager. Under LLXPRT_FAKE_RESPONSES this registers only
 * FakeProvider and sets it active.
 */
export function registerProvidersOntoManager(
  isolatedManager: IsolatedRuntimeContextHandle['providerManager'],
  source: {
    settingsService: IsolatedRuntimeContextHandle['settingsService'];
    runtimeId: IsolatedRuntimeContextHandle['runtimeId'];
    metadata: IsolatedRuntimeContextHandle['metadata'];
  },
  config: Config,
): void {
  const context = {
    settingsService: source.settingsService,
    runtimeId: source.runtimeId,
    metadata: source.metadata,
  };
  const { manager: registered } = createProviderManager(
    context as Parameters<typeof createProviderManager>[0],
    { config },
  );
  for (const name of registered.listProviders()) {
    const provider = registered.getProviderByName(name);
    if (
      provider !== undefined &&
      !isolatedManager.listProviders().includes(name)
    ) {
      isolatedManager.registerProvider(provider);
    }
  }
  // Under LLXPRT_FAKE_RESPONSES, FakeProvider is set active by createProviderManager.
  // Mirror the active provider onto the isolated manager.
  try {
    const active = registered.getActiveProvider();
    const activation = isolatedManager.setActiveProvider(active.name);
    if (activation instanceof Promise) {
      // setActiveProvider is void | Promise<void>; on the async path a late
      // rejection would otherwise surface as an unhandled rejection. Mirroring
      // the active provider is best-effort, so swallow it exactly like the
      // synchronous catch below ("no active provider — safe to skip").
      activation.catch(() => undefined);
    }
  } catch {
    // No active provider — safe to skip.
  }
}

/**
 * The DEFAULT tool scheduler factory injected by createAgent when the caller
 * supplies none. Constructs a {@link CoreToolScheduler} backed by the tool
 * registry, optionally wrapped so every tool surfaces a REAL confirmation (the
 * confirmation-forcing seam).
 *
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 * @pseudocode tool-confirmation-merge.md steps 10-31 (confirmation-forcing seam)
 */
function createDefaultToolSchedulerFactory(options: {
  readonly forceConfirmations: boolean;
}): ToolSchedulerFactory {
  return (schedulerOptions) => {
    const registry = options.forceConfirmations
      ? wrapRegistryWithConfirmation(schedulerOptions.toolRegistry)
      : schedulerOptions.toolRegistry;
    return new CoreToolScheduler({
      config: schedulerOptions.config,
      messageBus: schedulerOptions.messageBus,
      toolRegistry: registry,
      ...(schedulerOptions.outputUpdateHandler !== undefined
        ? { outputUpdateHandler: schedulerOptions.outputUpdateHandler }
        : {}),
      ...(schedulerOptions.onAllToolCallsComplete !== undefined
        ? { onAllToolCallsComplete: schedulerOptions.onAllToolCallsComplete }
        : {}),
      ...(schedulerOptions.onToolCallsUpdate !== undefined
        ? { onToolCallsUpdate: schedulerOptions.onToolCallsUpdate }
        : {}),
      getPreferredEditor: schedulerOptions.getPreferredEditor,
      onEditorClose: schedulerOptions.onEditorClose,
      ...(schedulerOptions.onEditorOpen !== undefined
        ? { onEditorOpen: schedulerOptions.onEditorOpen }
        : {}),
      ...(schedulerOptions.toolContextInteractiveMode !== undefined
        ? {
            toolContextInteractiveMode:
              schedulerOptions.toolContextInteractiveMode,
          }
        : {}),
    });
  };
}
