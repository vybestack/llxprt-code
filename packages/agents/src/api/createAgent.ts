/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { prepareImageConstruction } from './session-image-assembly.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';

import {
  assembleModelSelection,
  type ModelSelectionOperations,
} from '@vybestack/llxprt-code-providers/runtime/providerMutations.js';

import {
  prepareAgentShellOwner,
  cleanupFailedShellBootstrap,
} from './agent-shell-assembly.js';
import {
  parseAgentConstruction,
  agentMcpAssemblyOptions,
} from './agent-construction-input.js';
import type { McpAssemblyOptions } from './mcpOAuthAssembly.js';
import {
  initializePolicyComposition,
  createOwnedSessionRoots,
  prepareOwnedMediaRuntime,
} from './policyComposition.js';
import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { WorkspaceSkillOperations } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';

import type { SessionClientOwner } from '../session/session-client-owner.js';

import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import type { TaskLaunchOwner } from '../session/task-launch-owner.js';
import type { ShellJobOwner } from '../session/shell-job-owner.js';

/**
 * @plan:PLAN-20260617-COREAPI.P15
 * @requirement:REQ-001
 * @requirement:REQ-003
 * @pseudocode createAgent.md steps 10-176
 */

import { buildFacadeState } from './agentBootstrap.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import type { AgentMcpOperations } from './mcpRuntimeAssembly.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { type IsolatedRuntimeContextHandle } from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import { readActiveProviderName } from '@vybestack/llxprt-code-providers/runtime/providerReadOperations.js';
import type {
  AgentRuntimeFactoryBindings,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { SchedulerConstruction } from '../session/assembleSchedulerOwner.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  AgentConfig,
  AgentSchedulerFactory,
  AgentSchedulerHandle,
  EditorCallbacks,
  ProviderActivationIntent,
} from './config-types.js';
import type { AgentAuth } from './config-types.js';
import type { Agent } from './agent.js';
import type { AgentConfigSchema } from './config-schema.js';
import { toConfigParameters } from './agentConfig.adapter.js';
import { AgenticLoop } from '../core/agenticLoop/AgenticLoop.js';
import type { DisplayCallbacks } from '../core/agenticLoop/types.js';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
import { wrapRegistryWithConfirmation } from './confirmationForcing.js';
import { rebuildLoop, type LoopHolder } from './loop/rebuildLoop.js';
import { buildAgent } from './agentImpl.js';
import {
  assembleProviderSwitch,
  assembleSessionProviderSwitch,
} from './providerSwitchAssembly.js';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-providers/runtime/providerSwitch.js';
import { executeProviderActivation } from './providerActivationExecutor.js';
import { PLACEHOLDER_MODEL } from './constants.js';
import {
  type resolveAuthType,
  wrapSchedulerFactory,
  wrapApprovalHandler,
  createStableDisplayCallbacks,
  type StableDisplayCallbacksHolder,
  type StableEditorCallbacksHolder,
  recordOwnership,
  AgentBootstrapError,
} from './agentBootstrap.js';

/**
 * Builds a ready Agent by composing shipped primitives through a shared runtime
 * context with a single shared MessageBus.
 * @pseudocode createAgent.md steps 10-176
 */
import { assembleHostGitHubBroker } from './host-github-broker-owner.js';

export async function createAgent(rawConfig: AgentConfig): Promise<Agent> {
  const images = prepareImageConstruction(rawConfig.imageOperation);
  const github = assembleHostGitHubBroker(rawConfig);
  try {
    return await createAgentWithHostGitHub(
      { ...rawConfig, imageOperation: images.selection },
      github,
    );
  } catch (primaryError) {
    const cleanup = await Promise.allSettled([
      github?.cleanupFailedConstruction(),
      images.cleanupFailedConstruction(),
    ]);
    const failures = cleanup.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(
        [primaryError, ...failures],
        'createAgent GitHub cleanup failed',
      );
    throw primaryError;
  }
}

async function createAgentWithHostGitHub(
  rawConfig: AgentConfig,
  github: ReturnType<typeof assembleHostGitHubBroker>,
): Promise<Agent> {
  // @pseudocode createAgent.md steps 10-13: validate config, resolve auth, runtimeId
  // STRICT-SCHEMA HAZARD: destructure callbacks off the input BEFORE parsing —
  // AgentConfigSchema is .strict() and rejects function-typed fields.
  const construction = parseAgentConstruction(rawConfig);
  const {
    parsed,
    resolvedAuth,
    runtimeId,
    onApproval,
    onOAuthPrompt,
    editorCallbacks,
    toolSchedulerFactory,
    runtimeFactoryBindings,
    runtimeActivationBindings,
    tokenStore,
    suppliedMediaOwner,
  } = construction;

  const factories = runtimeFactoryBindings;
  const { params, forceConfirmations } = prepareAgentConfig(
    parsed,
    runtimeId,
    factories,
  );
  // Registry of scheduler handles created via a caller-injected factory. The
  // facade retains these and Agent.dispose() tears them down (dispose.md lines
  // 40-47). Empty unless a toolSchedulerFactory was supplied.
  const injectedSchedulerHandles: AgentSchedulerHandle[] = [];
  const schedulerFactory = resolveSchedulerFactory(
    forceConfirmations,
    toolSchedulerFactory,
    injectedSchedulerHandles,
  );
  // @pseudocode createAgent.md steps 30-38: construct Config + ONE shared MessageBus
  const { config, messageBus, policyOwner } = initializePolicyComposition(
    params,
    parsed,
    forceConfirmations,
    rawConfig.trustPort,
  );
  // Agent-owned runtime managers (issue #3222): the Config constructor does
  // not attach ProfileManager/SubagentManager, and TaskTool registration
  // (and skill discovery) need them at initialize() time.
  const mediaOwner = suppliedMediaOwner ?? createSessionMedia(config);
  const handle = await prepareOwnedMediaRuntime(
    config,
    mediaOwner,
    factories,
    parsed,
    runtimeId,
    runtimeActivationBindings,
    tokenStore,
    messageBus,
    policyOwner,
    rawConfig,
  );
  return finishCreatedAgent(
    handle,
    config,
    messageBus,
    agentMcpAssemblyOptions(rawConfig, construction),
    parsed,
    resolvedAuth,
    runtimeId,
    onApproval,
    onOAuthPrompt,
    editorCallbacks,
    injectedSchedulerHandles,
    schedulerFactory,
    mediaOwner,
    factories,
    policyOwner,
    github,
  );
}

function createSessionMedia(config: Config): SessionMediaOwner {
  return new SessionMediaOwner(
    config.projectTempDir,
    config.getMediaStoreQuotaByteLimit(),
  );
}

async function finishCreatedAgent(
  handle: IsolatedRuntimeContextHandle,
  config: Config,
  messageBus: MessageBus,
  mcpOptions: McpAssemblyOptions & Pick<AgentConfig, 'imageOperation'>,
  parsed: ReturnType<typeof AgentConfigSchema.parse>,
  resolvedAuth: ReturnType<typeof resolveAuthType>,
  runtimeId: string,
  onApproval: AgentConfig['onApproval'],
  onOAuthPrompt: AgentConfig['onOAuthPrompt'],
  editorCallbacks: EditorCallbacks | undefined,
  injectedSchedulerHandles: AgentSchedulerHandle[],
  schedulerFactory: SchedulerConstruction,
  mediaOwner: SessionMediaOwner,
  factories: AgentRuntimeFactoryBindings | undefined,
  policyOwner: RuntimePolicyOwner,
  github: ReturnType<typeof assembleHostGitHubBroker>,
): Promise<Agent> {
  let disposeMcpRuntime = async (): Promise<void> => policyOwner.dispose();
  let agent: Agent;
  let sessionClient: SessionClientOwner | undefined;
  try {
    await handle.activate();
    const [mcpRuntime, ownedSessionClient] = await createOwnedSessionRoots(
      handle,
      mediaOwner,
      factories?.agentClientFactory,
      mcpOptions,
      policyOwner,
      factories?.taskToolRegistration(),
      (parsed.harness?.forceConfirmations ?? true) && config.isInteractive(),
    );
    disposeMcpRuntime = () => mcpRuntime.dispose();
    sessionClient = ownedSessionClient;
    sessionClient.bindHostGitHub(github);
    await ownedSessionClient.initializeTools();
    const activationOutcome = await activateCreatedSession(
      parsed,
      resolvedAuth,
      handle,
      config,
      messageBus,
      mcpRuntime,
      ownedSessionClient,
    );
    agent = await finalizeAgent(
      { ...parsed, ...activationOutcome },
      resolvedAuth,
      config,
      handle.providerManager,
      handle.oauthManager,
      handle.settingsService,
      runtimeId,
      handle,
      messageBus,
      onApproval,
      onOAuthPrompt,
      editorCallbacks,
      injectedSchedulerHandles,
      'agent',
      disposeMcpRuntime,
      mcpRuntime,
      schedulerFactory,
      undefined,
      'config',
      mediaOwner,
      ownedSessionClient,
      mcpRuntime.workspaceSkills.operations,
    );
  } catch (primaryError) {
    return cleanupFailedCreatedAgent(
      primaryError,
      handle,
      mediaOwner,
      sessionClient,
      disposeMcpRuntime,
    );
  }
  return startAgentSession(agent);
}

async function activateCreatedSession(
  parsed: Parameters<typeof applyActivation>[0],
  resolvedAuth: Parameters<typeof applyActivation>[1],
  handle: IsolatedRuntimeContextHandle,
  config: Config,
  messageBus: MessageBus,
  mcpRuntime: McpRuntimeOwner,
  client: SessionClientOwner,
): ReturnType<typeof applyActivation> {
  return applyActivation(
    parsed,
    resolvedAuth,
    config,
    messageBus,
    assembleSessionProviderSwitch(handle, client.operations.refreshAuth),
    handle.settingsService,
    mcpRuntime,
    handle.providerManager,
    (method) => client.refreshAuth(method),
    assembleModelSelection(handle.settingsOwner),
  );
}

async function startAgentSession(agent: Agent): Promise<Agent> {
  try {
    await agent.hooks.triggerSessionStart();
    return agent;
  } catch (primaryError) {
    try {
      await agent.dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [primaryError, cleanupError],
        'Agent SessionStart and cleanup failed',
      );
    }
    throw primaryError;
  }
}

/**
 * Builds the shared holders + ONE stable forwarding DisplayCallbacks object.
 * The stable object reads live from the holders so post-construction
 * setDisplayCallbacks/setEditorCallbacks are observable by the CURRENT loop.
 */
function buildStableDisplayCallbacks(
  editorCallbacks: EditorCallbacks | undefined,
): {
  readonly editorCallbacksHolder: StableEditorCallbacksHolder;
  readonly displayCallbacksHolder: StableDisplayCallbacksHolder;
  readonly displayCallbacks: DisplayCallbacks;
} {
  const editorCallbacksHolder: StableEditorCallbacksHolder = {
    editorCallbacks: editorCallbacks ?? {},
  };
  const displayCallbacksHolder: StableDisplayCallbacksHolder = {};
  return {
    editorCallbacksHolder,
    displayCallbacksHolder,
    displayCallbacks: createStableDisplayCallbacks(
      editorCallbacksHolder,
      displayCallbacksHolder,
    ),
  };
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
  settings: SettingsService,
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
  disposeMcpRuntime: (() => Promise<void>) | undefined,
  mcpOperations: AgentMcpOperations,
  schedulerFactory: SchedulerConstruction = (options) =>
    new CoreToolScheduler(options),
  borrowedTasks: AsyncTaskManager | undefined,
  sessionIdentityOwnership: 'config' | 'facade',
  mediaOwner: SessionMediaOwner | undefined,
  sessionClient: SessionClientOwner,
  workspaceSkills: WorkspaceSkillOperations,
): Promise<Agent> {
  // @pseudocode createAgent.md steps 105-113: runtime state (runtimeId REQUIRED)

  // @pseudocode createAgent.md steps 130-148: build the initial loop via rebuildLoop
  const { taskLaunchOwner, shellOwner, loopHolder } = prepareAgentShellOwner(
    settings,
    borrowedTasks,
    schedulerFactory,
  );
  const resolveClient = () => sessionClient.getAgentClient();
  const approvalHandler = onApproval
    ? wrapApprovalHandler(onApproval)
    : undefined;
  try {
    return await assembleFacade({
      taskLaunchOwner,
      shellOwner,
      sessionClient,
      workspaceSkills,
      config,
      manager,
      oauthManager,
      sharedSettingsService: settings,
      runtimeId,
      handle,
      messageBus: sessionClient.messageBus,
      loopHolder,
      runtimeState: buildFacadeState(parsed, resolvedAuth.baseUrl, runtimeId),
      resolveClient,
      approvalHandler,
      ...buildStableDisplayCallbacks(editorCallbacks),
      onOAuthPrompt,
      disposeMcpRuntime,
      mcpOperations,
      editorCallbacks,
      initialAuth: parsed.auth,
      injectedSchedulerHandles,
      configOwnership,
      sessionIdentityOwnership,
      mediaOwner,
    });
  } catch (primaryError) {
    return cleanupFailedShellBootstrap(
      primaryError,
      taskLaunchOwner,
      shellOwner,
    );
  }
}

/**
 * Deps bundle for {@link assembleFacade}: the post-loop facade construction
 * inputs threaded out of finalizeAgent to keep that function within the
 * per-function line budget.
 * @pseudocode createAgent.md steps 150-160
 */
interface AssembleFacadeDeps {
  readonly sessionClient: SessionClientOwner;
  readonly workspaceSkills: WorkspaceSkillOperations;
  readonly mediaOwner: SessionMediaOwner | undefined;
  readonly taskLaunchOwner: TaskLaunchOwner;
  readonly shellOwner: ShellJobOwner;
  readonly mcpOperations: AgentMcpOperations;
  readonly disposeMcpRuntime: (() => Promise<void>) | undefined;
  readonly config: Config;
  readonly manager: RuntimeProviderManager;
  readonly oauthManager: OAuthManager;
  readonly sharedSettingsService: SettingsService;
  readonly runtimeId: string;
  readonly handle: IsolatedRuntimeContextHandle;
  readonly messageBus: MessageBus;
  readonly loopHolder: LoopHolder;
  readonly runtimeState: ReturnType<typeof createAgentRuntimeState>;
  readonly resolveClient: () => AgentClientContract;
  readonly approvalHandler: ReturnType<typeof wrapApprovalHandler> | undefined;
  readonly displayCallbacks: DisplayCallbacks;
  readonly editorCallbacksHolder: StableEditorCallbacksHolder;
  readonly displayCallbacksHolder: StableDisplayCallbacksHolder;
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
  readonly sessionIdentityOwnership: 'config' | 'facade';
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
  rebuildLoop({
    telemetry: deps.handle.settingsOwner.telemetry,
    loopHolder: deps.loopHolder,
    resolveClient: deps.resolveClient,
    toolSelection: deps.sessionClient.toolCatalog.selection,
    readApprovalMode: () =>
      deps.mcpOperations.trust.isTrustedFolder()
        ? deps.config.getApprovalMode()
        : ApprovalMode.DEFAULT,
    readExecutionPolicy: () =>
      deps.handle.settingsOwner.readToolExecutionPolicy(),
    getToolGovernance: () => deps.sessionClient.toolCatalog.readGovernance(),
    config: deps.config,
    messageBus: deps.messageBus,
    ...(deps.approvalHandler !== undefined
      ? { approvalHandler: deps.approvalHandler }
      : {}),
    displayCallbacks: deps.displayCallbacks,
    AgenticLoopCtor: AgenticLoop,
  });
  const ownership = recordOwnership({
    runtimeHandle: deps.handle,
    config: deps.config,
    messageBus: deps.messageBus,
    loopHolder: deps.loopHolder,
    runtimeState: deps.runtimeState,
    injectedSchedulerHandles: deps.injectedSchedulerHandles,
    configOwnership: deps.configOwnership,
    disposeMcpRuntime: deps.disposeMcpRuntime,
  });
  const agent = buildAgent({
    sessionClient: deps.sessionClient,
    workspaceSkills: deps.workspaceSkills,
    mediaOwner: deps.mediaOwner,
    taskLaunchOwner: deps.taskLaunchOwner,
    shellOwner: deps.shellOwner,
    config: deps.config,
    mcpOperations: deps.mcpOperations,
    providerManager: deps.manager,
    oauthManager: deps.oauthManager,
    switchProvider: assembleProviderSwitch(
      deps.config,
      deps.sharedSettingsService,
      deps.manager,
      deps.oauthManager,
      () => deps.handle.readRuntimeKind(),
      () => deps.sessionClient.refreshAuth(),
      deps.handle.settingsOwner,
    ),
    settingsService: deps.sharedSettingsService,
    settingsOwner: deps.handle.settingsOwner,
    runtimeId: deps.runtimeId,
    runtimeHandle: deps.handle,
    messageBus: deps.messageBus,
    loopHolder: deps.loopHolder,
    runtimeState: deps.runtimeState,
    ownership,
    sessionIdentityOwnership: deps.sessionIdentityOwnership,
    rebuildLoop,
    resolveClient: deps.resolveClient,
    initialHistoryService: initializeAgentHistory(
      deps.sessionClient.getAgentClient(),
    ),
    ...(deps.approvalHandler !== undefined
      ? { approvalHandler: deps.approvalHandler }
      : {}),
    displayCallbacks: deps.displayCallbacks,
    editorCallbacksHolder: deps.editorCallbacksHolder,
    displayCallbacksHolder: deps.displayCallbacksHolder,
    onOAuthPrompt: deps.onOAuthPrompt,
    editorCallbacks: deps.editorCallbacks,
    ...(deps.initialAuth !== undefined
      ? { initialAuth: deps.initialAuth }
      : {}),
  });

  // SessionStart is driven by the frontend after it has installed observers
  // and is ready to consume the hook's system message and additional context.
  return agent;
}

function initializeAgentHistory(
  client: AgentClientContract | undefined,
): HistoryService {
  if (client === undefined) {
    throw new AgentBootstrapError('no post-auth agent client');
  }
  const history = client.getHistoryService() ?? new HistoryService();
  client.storeHistoryServiceForReuse(history);
  return history;
}

function prepareAgentConfig(
  parsed: ReturnType<typeof AgentConfigSchema.parse>,
  runtimeId: string,
  _factories: AgentRuntimeFactoryBindings | undefined,
): {
  readonly params: ConfigParameters;
  readonly forceConfirmations: boolean;
} {
  const params = {
    ...toConfigParameters(parsed as unknown as AgentConfig),
    sessionId: runtimeId,
  };
  return { params, forceConfirmations: applyHarnessGates(parsed, params) };
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
    (parsed.harness?.forceConfirmations ?? true) && params.interactive === true
  );
}

/**
 * Constructs the Config, applies workspace-context + confirmation-forcing
 * policy gates, and builds the shared MessageBus. Extracted from createAgent
 * to stay within the per-function line budget.
 *
 * @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006
 * @pseudocode createAgent.md steps 30-38 + tool-confirmation-merge.md steps 10-31
 */

/**
 * Resolves the agents-owned scheduler construction. When the caller
 * injects a factory, wraps it around the default (confirmation-forcing)
 * CoreToolScheduler and retains the handles for facade-level disposal. When no
 * factory is injected, uses the default directly.
 *
 * @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006
 */
export function resolveSchedulerFactory(
  forceConfirmations: boolean,
  injected: AgentSchedulerFactory | undefined,
  injectedSchedulerHandles: AgentSchedulerHandle[],
): SchedulerConstruction {
  const defaultSchedulerFactory = createDefaultToolSchedulerFactory({
    forceConfirmations,
  });
  if (injected !== undefined) {
    // @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-006 @requirement:REQ-016
    // The caller injected a factory: each per-turn scheduler is still a real,
    // functioning CoreToolScheduler (built by defaultSchedulerFactory), while
    // the injected factory is invoked alongside and the handle it returns is
    // retained for facade-level disposal. The injected factory FUNCTION is
    // never disposed — only the handle instances it creates.
    return wrapSchedulerFactory(
      injected,
      defaultSchedulerFactory,
      injectedSchedulerHandles,
    );
  }
  return defaultSchedulerFactory;
}

/** Applies the explicit or synthesized intent and returns the activated state. */
async function applyActivation(
  parsed: {
    readonly activation?: ProviderActivationIntent;
    readonly provider: string;
    readonly model: string;
  },
  resolvedAuth: {
    readonly apiKey: string | undefined;
    readonly baseUrl: string | undefined;
    readonly authMethod: string | undefined;
  },
  config: Config,
  messageBus: MessageBus,
  switchProvider: ProviderSwitcher,
  settingsService: SettingsService,
  mcpRuntime: McpRuntimeOwner,
  manager: RuntimeProviderManager,
  refreshClient: (method?: string) => Promise<void>,
  selection: ModelSelectionOperations,
): Promise<{ readonly provider: string; readonly model: string }> {
  const intent: ProviderActivationIntent = parsed.activation ?? {
    provider: parsed.provider,
    providerSwitchPolicy: 'best-effort',
    ...(parsed.model.trim() && parsed.model !== PLACEHOLDER_MODEL
      ? { model: parsed.model }
      : {}),
    authMethod: resolvedAuth.authMethod,
    ...(resolvedAuth.apiKey !== undefined || resolvedAuth.baseUrl !== undefined
      ? {
          cliOverrides: {
            key: resolvedAuth.apiKey,
            baseUrl: resolvedAuth.baseUrl,
          },
        }
      : {}),
  };
  mcpRuntime.assertConfig(config, messageBus);
  await mcpRuntime.initialize();
  const activationResult = await executeProviderActivation(
    config,
    intent,
    switchProvider,
    settingsService,
    manager,
    refreshClient,
    selection,
  );
  if (activationResult.authFailed) {
    const underlying = activationResult.authError;
    throw new AgentBootstrapError(
      `createAgent activation failed: ${
        underlying instanceof Error ? underlying.message : String(underlying)
      }`,
      { cause: underlying },
    );
  }
  // Explicit intents report the activated provider; legacy inputs retain their
  // public provider label when fake responses or an unconfigured start are used.
  const runtimeProvider =
    activationResult.activeProvider ??
    manager.getActiveProviderName() ??
    safeActiveProviderName(settingsService, manager);
  const postProvider =
    parsed.activation === undefined
      ? parsed.provider
      : runtimeProvider || parsed.provider;
  // Filter out the placeholder-model sentinel — switchActiveProvider sets the
  // active model to that placeholder while auth initializes, but the
  // externally observable provider/model snapshot should reflect the REAL
  // model once activation resolves (#2374).
  const configModel = config.getModel();
  const resolvedConfigModel =
    configModel !== PLACEHOLDER_MODEL ? configModel : '';

  const activeModel = safeActiveModelName(selection);
  const runtimeModel = resolvedConfigModel || activeModel;
  const postModel = runtimeModel || parsed.model;
  return { provider: postProvider, model: postModel };
}

/** Reads the active provider name without throwing when unset. */
function safeActiveProviderName(
  settings: SettingsService,
  manager: RuntimeProviderManager,
): string {
  return readActiveProviderName(settings, manager) ?? '';
}

/** Reads the active model name without throwing when unset. */
function safeActiveModelName(selection: ModelSelectionOperations): string {
  try {
    return selection.readModel() ?? '';
  } catch {
    return '';
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
}): SchedulerConstruction {
  return (schedulerOptions) => {
    const registry = options.forceConfirmations
      ? wrapRegistryWithConfirmation(schedulerOptions.toolRegistry)
      : schedulerOptions.toolRegistry;
    return new CoreToolScheduler({
      telemetry: schedulerOptions.telemetry,
      config: schedulerOptions.config,
      readExecutionPolicy: schedulerOptions.readExecutionPolicy,
      readApprovalMode: schedulerOptions.readApprovalMode,
      getToolGovernance: schedulerOptions.getToolGovernance,
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

async function cleanupFailedCreatedAgent(
  primaryError: unknown,
  handle: IsolatedRuntimeContextHandle,
  mediaOwner: SessionMediaOwner,
  sessionClient: SessionClientOwner | undefined,
  disposeMcpRuntime: (() => Promise<void>) | undefined,
): Promise<never> {
  const config = handle.config;
  const mcpCleanup = await Promise.allSettled([disposeMcpRuntime?.()]);
  const clientCleanup = await Promise.allSettled([sessionClient?.dispose()]);
  const cleanup = await Promise.allSettled([
    handle.cleanup(),
    config.dispose(),
  ]);
  const mediaCleanup = await Promise.allSettled([mediaOwner.dispose()]);
  const failures = [
    ...mcpCleanup,
    ...clientCleanup,
    ...cleanup,
    ...mediaCleanup,
  ].flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (failures.length > 0) {
    throw new AggregateError(
      [primaryError, ...failures],
      'createAgent bootstrap cleanup failed',
    );
  }
  throw primaryError;
}

export { registerProvidersOntoManager } from './policyComposition.js';
