import { assertPreflightOwners } from './activationPreflightState.js';
import {
  cleanupFailedFromConfig,
  closePreflightAfterAdoption,
  rethrowPrimaryAfterCleanup,
} from './fromConfig-cleanup.js';
import {
  assembleSessionImages,
  prepareImageConstruction,
} from './session-image-assembly.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core';
import {
  assembleAdoptedDefinitionOperations,
  adoptedDefinitionCleanup,
} from './adopted-definition-assembly.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  assembleModelSelection,
  type ModelSelectionOperations,
} from '@vybestack/llxprt-code-providers/runtime/providerMutations.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
/**
 * @plan:PLAN-20260621-COREAPIREMED.P09
 * @requirement:REQ-001,REQ-005,REQ-INT-001
 * @pseudocode lines 10-78
 *
 * Public config-adoption entry: builds a ready Agent by ADOPTING an
 * existing caller-supplied Config (never constructing a second one) and
 * reusing the SAME shared finalize path createAgent uses (CRIT-4).
 */

import { admittedEndpoint } from '../core/admittedRouteSecurity.js';
import { SessionClientOwner } from '../session/session-client-owner.js';
import { buildAgentClientFactory } from './agentBootstrap.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import { assembleMcpRuntime } from './mcpOAuthAssembly.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  createIsolatedRuntimeContext,
  createRuntimeActivationBindings,
  type IsolatedRuntimeContextHandle,
} from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { AgentSchedulerHandle } from './config-types.js';
import type { FromConfigOptions } from './config-types.js';
import { FromConfigValidatableSchema } from './config-types.js';
import type { Agent } from './agent.js';
import {
  generateRuntimeId,
  AgentBootstrapError,
  validateAgentRuntimeId,
} from './agentBootstrap.js';
import { assembleProviderSwitch } from './providerSwitchAssembly.js';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-providers/runtime/providerSwitch.js';
import { executeProviderActivation } from './providerActivationExecutor.js';
import { AgentActivationBootstrap } from './activationPreflightState.js';
import {
  finalizeAgent,
  registerProvidersOntoManager,
  resolveSchedulerFactory,
} from './createAgent.js';

/**
 * Adopts an existing caller-supplied Config and returns a ready Agent.
 *
 * Mirrors createAgent's finalize path WITHOUT re-constructing a Config,
 * ProviderManager, or (when a caller bus is supplied) a MessageBus. The
 * returned Agent's dispose() skips the caller-owned Config teardown
 * (REQ-001.3).
 *
 * Provider activation / auth (#2374): when `options.activation` is supplied,
 * fromConfig executes the declarative intent via executeProviderActivation
 * INSTEAD of the legacy bare refreshAuth(undefined) call, so frontends no longer
 * need to orchestrate switchActiveProvider / refreshAuth / credential overrides
 * by hand. Callers that need to observe fatal auth failure (`authFailed`)
 * use an agents-owned activation bootstrap before calling fromConfig, then
 * supply its operation and token together with the same activation intent.
 *
 * @plan:PLAN-20260621-COREAPIREMED.P09
 * @requirement:REQ-001,REQ-005,REQ-INT-001
 * @pseudocode lines 10-48
 */
import {
  assembleHostGitHubBroker,
  type HostGitHubBrokerOwner,
} from './host-github-broker-owner.js';

export async function fromConfig(options: FromConfigOptions): Promise<Agent> {
  const images = prepareImageConstruction(options.imageOperation);
  const github = assembleHostGitHubBroker(options);
  let agent: Agent;
  try {
    if (!hasConfig(options, 'config')) {
      throw new AgentBootstrapError('fromConfig requires an existing Config');
    }
    assertMcpHandoff(options);
    assertPreflightOwners(options);
    if (
      options.activationPreflight !== undefined &&
      options.memoryOwner !== undefined
    )
      throw new AgentBootstrapError(
        'Preflight memory ownership cannot be replaced during adoption',
      );
    if (options.activationPreflight !== undefined) {
      AgentActivationBootstrap.validate(
        options.activationPreflight,
        options.config,
        options.activation,
        options.providerManager,
      );
    }
    agent = await adoptConfig(
      { ...options, imageOperation: images.selection },
      github,
    );
  } catch (primaryError) {
    return cleanupFailedFromConfig(primaryError, options, github, images);
  }
  await closePreflightAfterAdoption(options, agent);
  return agent;
}

function bindAdoptedSessionHooks(
  client: SessionClientOwner,
  mcp: McpRuntimeOwner,
  options: FromConfigOptions,
): void {
  bindAdoptedDefinitions(client, mcp, options);
  if (client.hasHookComposition()) {
    if (options.hookOwner !== undefined)
      throw new AgentBootstrapError(
        'Preflight hook ownership cannot be replaced during adoption',
      );
  } else {
    client.bindHooks(options.hookOwner);
  }
}

async function adoptConfig(
  options: FromConfigOptions,
  github: HostGitHubBrokerOwner | undefined,
): Promise<Agent> {
  // @pseudocode lines 11-13: validate presence + the small validatable portion.
  // The FromConfigOptions type marks config as required, but at runtime callers
  // may omit it (T1d); read through a generic presence check so the lint
  // accepts the runtime-undefined check without an unsafe assertion.
  FromConfigValidatableSchema.parse({
    sessionId: options.sessionId,
    activation: options.activation,
  });

  // @pseudocode line 14: ADOPT — never construct.
  const config: Config = options.config;
  assertBorrowedClient(options);

  // @pseudocode line 15: runtimeId (sessionId takes precedence; otherwise generate).
  const runtimeId = options.sessionId ?? generateRuntimeId();
  validateAgentRuntimeId(runtimeId);

  // @pseudocode line 16: reach the Config's SettingsService (no second store).
  const settingsService = options.settingsService;

  // Adopt an explicit caller bus first, then the Config's assembled runtime bus.
  // Only non-CLI consumers without either seam receive a newly owned bus.
  const mcpRuntime = await resolveAdoptedMcpRuntime(options);
  const messageBus =
    options.messageBus ??
    options.activationPreflight?.operation.messageBus ??
    mcpRuntime.messageBus;
  mcpRuntime.assertConfig(config, messageBus);

  // @pseudocode line 18 (CRIT-1): adopt the Config's existing manager.

  // @pseudocode lines 20-28: adopt the runtime context (NOT a second manager).
  const mediaOwner = await assembleAdoptedMedia(options);
  const handle = await prepareAdoptedMediaRuntime(
    options,
    runtimeId,
    mediaOwner,
    mcpRuntime,
  );

  let sessionClient: SessionClientOwner | undefined;
  try {
    sessionClient = await initializeAdoptedClient(
      options,
      handle,
      mediaOwner,
      mcpRuntime,
    );
    sessionClient.bindHostGitHub(github);
    bindAdoptedSessionHooks(sessionClient, mcpRuntime, options);

    const activeSessionClient = sessionClient;
    // @pseudocode line 29: activate infrastructure for the supplied Config.
    await handle.activate();

    // @pseudocode line 37-48 (createAgent.ts:178-180 mirror): derive managers.
    const oauthManager = handle.oauthManager;

    // @plan:PLAN-20270110-ISSUE2378.P02 @requirement:REQ-2378-002
    // The adopted Config's SettingsService is carried by the isolated runtime
    // handle; every consumer below reads it from that explicit owner.

    await initializeAdoptedSession(options, mcpRuntime, activeSessionClient);

    // @plan:PLAN-20270104-ISSUE2374.P03 @requirement:REQ-001
    await activateAdoptedSession(options, handle, activeSessionClient);

    // @pseudocode lines 37-48 (Mismatch 1): synthesize parsed + resolvedAuth.

    // @pseudocode lines 37-48: SHARED finalize (CRIT-4: single finalize path).
    // The 17th positional arg 'caller' threads REQ-001.3 ownership so dispose()
    // skips the caller-owned Config teardown.
    return await finalizeAdoptedAgent(
      options,
      await prepareAdoptedConfig(
        config,
        options,
        handle.settingsOwner,
        handle.tokenizerFactory,
      ),
      config,
      handle.providerManager,
      oauthManager,
      settingsService,
      runtimeId,
      handle,
      activeSessionClient.messageBus,
      mcpRuntime,
      mediaOwner,
      sessionClient,
    );
  } catch (primaryError) {
    return cleanupFailedAdoption(
      primaryError,
      handle,
      mcpRuntime,
      adoptedDefinitionCleanup(
        mcpRuntime,
        options.definitionOwner,
        options.definitionOwnership,
        ownsMcpRuntime(options),
      ),
      mediaOwner,
      sessionClient,
    );
  }
}

async function activateAdoptedSession(
  options: FromConfigOptions,
  handle: IsolatedRuntimeContextHandle,
  activeSessionClient: SessionClientOwner,
): Promise<void> {
  const config = options.config;
  const settingsService = options.settingsService;
  const oauthManager = handle.oauthManager;
  await resolveActivation(
    config,
    options,
    adoptedProviderSwitch(
      config,
      settingsService,
      handle.providerManager,
      oauthManager,
      handle,
      () => activeSessionClient.refreshAuth(),
    ),
    settingsService,
    handle.providerManager,
    () => activeSessionClient.getAgentClient(),
    (method) => activeSessionClient.refreshAuth(method),
    assembleModelSelection(handle.settingsOwner),
  );
}

async function initializeAdoptedClient(
  options: FromConfigOptions,
  handle: IsolatedRuntimeContextHandle,
  mediaOwner: SessionMediaOwner | undefined,
  mcpRuntime: McpRuntimeOwner,
): Promise<SessionClientOwner> {
  handle.settingsOwner.initializeProviderSelection(
    options.activation?.provider ?? options.config.getProvider(),
    options.activation?.model ?? options.config.getModel(),
  );
  const client = await adoptSessionClient(
    options,
    handle,
    mediaOwner,
    mcpRuntime,
  );
  assembleSessionImages(
    client,
    options.config.getTargetDir(),
    handle.providerManager,
    handle.oauthManager,
    handle.settingsService,
    options.imageOperation,
  );
  const mainScope = options.config.getSessionId();
  client.bindProviderFiles(
    handle.providerFileLifecycle,
    (provider) => handle.oauthManager.composeRetryOperations(provider),
    (scope) =>
      scope === mainScope
        ? Promise.resolve()
        : SessionClientOwner.cleanupProviderScope(
            handle.providerFileLifecycle,
            scope,
          ),
  );
  return client;
}

async function createAdoptedRuntime(
  options: FromConfigOptions,
  config: Config,
  messageBus: MessageBus,
  runtimeId: string,
  adoptedManager: RuntimeProviderManager | undefined,
): Promise<IsolatedRuntimeContextHandle> {
  const transferredOwner =
    options.activationPreflight?.operation.takeSettingsOwner(
      options.settingsService,
    );
  const settingsOwner = transferredOwner ?? options.settingsOwner;
  settingsOwner?.assertSettingsIdentity(options.settingsService);
  try {
    return createIsolatedRuntimeContext(
      {
        runtimeId,
        activationBindings:
          options.runtimeActivationBindings ??
          createRuntimeActivationBindings(),
        ...(options.tokenStore !== undefined
          ? { tokenStore: options.tokenStore }
          : {}),
        config,
        profileReads:
          options.definitionOwner?.profileReads ??
          options.activationPreflight?.operation.workspaceDefinitions
            .profileReads ??
          options.mcpRuntime?.profileDefinitions,
        tokenizerFactory:
          options.tokenizerFactory ??
          options.activationPreflight?.operation.tokenizerFactory,
        contentGeneratorFactory:
          options.contentGeneratorFactory ??
          options.activationPreflight?.operation.contentGeneratorFactory,
        settingsOwner,
        settingsOwnerOwnership:
          transferredOwner === undefined
            ? 'borrowed'
            : options.activationPreflight?.operation.settingsOwnerOwnership,
        messageBus,
        providerManager: adoptedManager,
        oauthManager:
          options.oauthManager ??
          options.activationPreflight?.operation.oauthManager,
        providerFileLifecycle:
          options.providerFileLifecycle ??
          options.activationPreflight?.operation.providerFileLifecycle,
        prepare: (ctx) => {
          if (adoptedManager === undefined)
            registerProvidersOntoManager(ctx.providerManager, ctx, ctx.config);
        },
      },
      options.settingsService,
    );
  } catch (error: unknown) {
    if (
      options.activationPreflight?.operation.settingsOwnerOwnership ===
      'transferred'
    )
      await transferredOwner?.dispose();
    throw error;
  }
}

function bindAdoptedDefinitions(
  sessionClient: SessionClientOwner,
  mcpRuntime: McpRuntimeOwner,
  options: FromConfigOptions,
): void {
  sessionClient.bindMcpRuntime(
    mcpRuntime,
    options.runtimeFactoryBindings?.taskToolRegistration(),
    assembleAdoptedDefinitionOperations(
      mcpRuntime,
      options.definitionOwner,
      options.config,
      options.definitionOwnership,
      ownsMcpRuntime(options),
    ),
  );
}

async function cleanupFailedAdoption(
  primaryError: unknown,
  handle: IsolatedRuntimeContextHandle,
  _mcpRuntime: McpRuntimeOwner,
  disposeWorkspace: (() => Promise<void>) | undefined,
  mediaOwner: SessionMediaOwner | undefined,
  sessionClient: SessionClientOwner | undefined,
): Promise<never> {
  const mcpCleanup = await Promise.allSettled([disposeWorkspace?.()]);
  const clientCleanup = await Promise.allSettled([sessionClient?.dispose()]);
  const runtimeCleanup = await Promise.allSettled([handle.cleanup()]);
  const mediaCleanup = await Promise.allSettled([mediaOwner?.dispose()]);
  const cleanup = [
    ...mcpCleanup,
    ...clientCleanup,
    ...runtimeCleanup,
    ...mediaCleanup,
  ];
  const failures = cleanup.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  return rethrowPrimaryAfterCleanup(
    primaryError,
    failures,
    'fromConfig bootstrap cleanup failed',
  );
}

async function initializeAdoptedSession(
  options: FromConfigOptions,
  mcpRuntime: McpRuntimeOwner,
  activeSessionClient: SessionClientOwner,
): Promise<void> {
  const config = options.config;
  await initializeAdoptedConfig(config, mcpRuntime, () =>
    activeSessionClient.publishTools(),
  );
  await activeSessionClient.initializeTools();
  if (options.prepareSessionTools)
    activeSessionClient.toolCatalog.prepareTools((tools) =>
      options.prepareSessionTools?.(
        config,
        activeSessionClient.messageBus,
        tools,
      ),
    );
}

async function initializeAdoptedConfig(
  config: Config,
  mcpRuntime: McpRuntimeOwner,
  _publishTools: () => Promise<void>,
): Promise<void> {
  await mcpRuntime.initialize();
}

/**
 * Finding 3 (#2378): adopt the EXACT assembled OAuthManager from the Config's
 * runtime bundle when available. Falls back to the isolated-runtime handle's
 * OAuthManager when no Config-associated runtime bundle was attached (e.g. Zed).
 */

/**
 * Executes the declarative activation intent (or backward-compatible bare
 * refreshAuth) against the adopted Config. When a preflight token is supplied,
 * consumes it with exact-match intent binding instead of re-running activation.
 * A declarative intent whose auth sequence failed is FATAL.
 *
 * @plan:PLAN-20270104-ISSUE2374.P03 @requirement:REQ-001
 */
async function resolveActivation(
  config: Config,
  options: FromConfigOptions,
  switchProvider: ProviderSwitcher,
  settingsService: SettingsService,
  manager: RuntimeProviderManager,
  readClient: () => AgentClientContract,
  refreshAuth: (method?: string) => Promise<void>,
  selection: ModelSelectionOperations,
): Promise<void> {
  if (options.activation !== undefined) {
    const activationResult =
      options.activationPreflight !== undefined
        ? AgentActivationBootstrap.consume(
            options.activationPreflight,
            config,
            options.activation,
            manager,
          )
        : await executeProviderActivation(
            config,
            options.activation,
            switchProvider,
            settingsService,
            manager,
            refreshAuth,
            selection,
          );
    if (activationResult.authFailed) {
      const underlying = activationResult.authError;
      throw new AgentBootstrapError(
        `fromConfig activation failed: ${
          underlying instanceof Error ? underlying.message : String(underlying)
        }`,
        { cause: underlying },
      );
    }
  } else if (!readClient().isInitialized()) {
    // Construct the auth client for an already-activated Config.
    await refreshAuth(undefined);
  }
}

/**
 * Derive the provider from the post-activation runtime truth, falling back to
 * the Config only when the adopted manager has no active provider.
 */
function buildParsedConfig(
  config: Config,
  options: FromConfigOptions,
  settingsOwner: SessionSettingsOwner,
): { provider: string; model: string; sessionId?: string } {
  const activeRuntimeProvider =
    options.providerManager?.getActiveProviderName() ?? config.getProvider();
  return {
    provider: activeRuntimeProvider ?? '',
    model: settingsOwner.readSelectedModel() ?? config.getModel(),
    ...(options.sessionId !== undefined
      ? { sessionId: options.sessionId }
      : {}),
  };
}

/**
 * Type guard: does the options object carry a non-null Config? The
 * FromConfigOptions type marks config as required, but at runtime a caller
 * may omit it (T1d). Reading via a generic value lookup satisfies the
 * no-unnecessary-condition lint without an unsafe assertion.
 *
 * @plan:PLAN-20260621-COREAPIREMED.P09
 * @requirement:REQ-001
 */
function hasConfig<K extends string>(
  obj: { readonly [P in K]?: unknown } | null | undefined,
  key: K,
): boolean {
  if (obj === null || typeof obj !== 'object') {
    return false;
  }
  const v: unknown = obj[key];
  return v !== null && v !== undefined;
}

function ownsMcpRuntime(options: FromConfigOptions): boolean {
  return (
    (options.mcpOwnership ??
      (options.mcpRuntime === undefined ? 'agent' : 'caller')) === 'agent'
  );
}

/**
 * Public readiness signal for workspace infrastructure initialization.
 *
 * @plan:PLAN-20260621-COREAPIREMED.P09
 * @requirement:REQ-001
 * @pseudocode lines 73-75
 */
export function isConfigInitialized(config: Config): boolean {
  return config.hasInitializationStarted();
}

function assertMcpHandoff(options: {
  readonly mcpRuntime?: McpRuntimeOwner;
  readonly mcpOwnership?: 'agent' | 'caller';
  readonly mcpHost?: unknown;
  readonly mcpTokenStorage?: unknown;
}): void {
  if (options.mcpOwnership === 'caller' && options.mcpRuntime === undefined) {
    throw new AgentBootstrapError(
      'Caller-owned MCP requires an explicit runtime handoff',
    );
  }
  if (
    options.mcpRuntime !== undefined &&
    (options.mcpHost !== undefined || options.mcpTokenStorage !== undefined)
  ) {
    throw new AgentBootstrapError(
      'MCP runtime handoff must retain its credential and browser capabilities',
    );
  }
}

async function prepareAdoptedConfig(
  config: Config,
  options: FromConfigOptions,
  settingsOwner: SessionSettingsOwner,
  tokenizerFactory: RuntimeTokenizerFactory,
): Promise<ReturnType<typeof buildParsedConfig>> {
  const parsed = buildParsedConfig(config, options, settingsOwner);
  await tokenizerFactory.prepareTokenizer?.(parsed.provider, parsed.model);
  return parsed;
}

function assembleAdoptedScheduler(options: FromConfigOptions): {
  injectedSchedulerHandles: AgentSchedulerHandle[];
  schedulerFactory: ReturnType<typeof resolveSchedulerFactory>;
} {
  const injectedSchedulerHandles: AgentSchedulerHandle[] = [];
  return {
    injectedSchedulerHandles,
    schedulerFactory: resolveSchedulerFactory(
      false,
      options.toolSchedulerFactory,
      injectedSchedulerHandles,
    ),
  };
}

function adoptMediaOwner(
  options: FromConfigOptions,
): SessionMediaOwner | undefined {
  const config = options.config;
  return (
    options.activationPreflight?.operation.takeMediaOwner(config) ??
    (options.agentClient?.mediaStore === undefined
      ? new SessionMediaOwner(
          config.projectTempDir,
          config.getMediaStoreQuotaByteLimit(),
        )
      : undefined)
  );
}

async function assembleAdoptedMedia(
  options: FromConfigOptions,
): Promise<SessionMediaOwner | undefined> {
  const owner = adoptMediaOwner(options);
  try {
    const store = options.agentClient?.mediaStore ?? owner?.store;
    if (store === undefined)
      throw new AgentBootstrapError('Missing explicit media owner');
    return owner;
  } catch (error) {
    return cleanupFailedMediaAssembly(error, options, owner);
  }
}

async function prepareAdoptedMediaRuntime(
  options: FromConfigOptions,
  runtimeId: string,
  owner: SessionMediaOwner | undefined,
  mcp: McpRuntimeOwner,
): Promise<IsolatedRuntimeContextHandle> {
  try {
    return await createAdoptedRuntime(
      options,
      options.config,
      options.messageBus ??
        options.activationPreflight?.operation.messageBus ??
        mcp.messageBus,
      runtimeId,
      options.providerManager,
    );
  } catch (error) {
    return cleanupFailedMediaAssembly(error, options, owner, mcp);
  }
}

function adoptedProviderSwitch(
  config: Config,
  settings: SettingsService,
  manager: RuntimeProviderManager,
  oauth: OAuthManager,
  handle: IsolatedRuntimeContextHandle,
  refreshAuth: () => Promise<void>,
): ProviderSwitcher {
  return assembleProviderSwitch(
    config,
    settings,
    manager,
    oauth,
    () => handle.readRuntimeKind(),
    refreshAuth,
    handle.settingsOwner,
  );
}

async function finalizeAdoptedAgent(
  options: FromConfigOptions,
  parsed: Awaited<ReturnType<typeof prepareAdoptedConfig>>,
  config: Config,
  manager: RuntimeProviderManager,
  oauthManager: OAuthManager,
  settingsService: SettingsService,
  runtimeId: string,
  handle: IsolatedRuntimeContextHandle,
  messageBus: MessageBus,
  mcpRuntime: McpRuntimeOwner,
  mediaOwner: SessionMediaOwner | undefined,
  sessionClient: SessionClientOwner,
): Promise<Agent> {
  const { injectedSchedulerHandles, schedulerFactory } =
    assembleAdoptedScheduler(options);
  return finalizeAgent(
    parsed,
    { baseUrl: admittedEndpoint(settingsService, parsed.provider) },
    config,
    manager,
    oauthManager,
    settingsService,
    runtimeId,
    handle,
    messageBus,
    options.onApproval,
    options.onOAuthPrompt,
    options.editorCallbacks,
    injectedSchedulerHandles,
    'caller',
    adoptedDefinitionCleanup(
      mcpRuntime,
      options.definitionOwner,
      options.definitionOwnership,
      ownsMcpRuntime(options),
    ),
    assembleAdoptedDefinitionOperations(
      mcpRuntime,
      options.definitionOwner,
      config,
      options.definitionOwnership,
      ownsMcpRuntime(options),
    ),
    schedulerFactory,
    options.asyncTaskManager,
    options.sessionIdentityOwnership ?? 'facade',
    mediaOwner,
    sessionClient,
    mcpRuntime.workspaceSkills.operations,
  );
}

function requireAdoptedStore(
  options: FromConfigOptions,
  owner: SessionMediaOwner | undefined,
) {
  const store = options.agentClient?.mediaStore ?? owner?.store;
  if (store === undefined)
    throw new AgentBootstrapError(
      'Missing explicit session client media store',
    );
  return store;
}

function adoptSessionClient(
  options: FromConfigOptions,
  handle: IsolatedRuntimeContextHandle,
  mediaOwner: SessionMediaOwner | undefined,
  mcp: McpRuntimeOwner,
): Promise<SessionClientOwner> {
  if (options.activationPreflight !== undefined) {
    const operation = options.activationPreflight.operation;
    if (
      operation.tokenizerFactory !== handle.tokenizerFactory ||
      operation.contentGeneratorFactory !== handle.contentGeneratorFactory
    )
      throw new AgentBootstrapError(
        'Preflight factories cannot be replaced during adoption',
      );
    const client = operation.takeSessionClient(options.config);
    client.bindProviderFiles(handle.providerFileLifecycle, (provider) =>
      handle.oauthManager.composeRetryOperations(provider),
    );
    return Promise.resolve(client);
  }
  return SessionClientOwner.create(
    options.config,
    assembleTaskSchemaPolicy(handle.settingsService),
    handle.providerManager,
    options.runtimeFactoryBindings?.agentClientFactory ??
      buildAgentClientFactory(),
    requireAdoptedStore(options, mediaOwner),
    mcp.readInstructions,
    mcp.workspacePaths,
    handle.settingsOwner,
    handle.contentGeneratorFactory,
    handle.tokenizerFactory,
    options.agentClient,
    options.policyOwner === undefined && options.mcpRuntime !== undefined
      ? undefined
      : options.messageBus,
  );
}

function assertBorrowedClient(options: FromConfigOptions): void {
  if (options.agentClient === undefined) return;
  if (options.mcpRuntime === undefined)
    throw new AgentBootstrapError(
      'Borrowed session client requires an explicit MCP runtime handoff',
    );
  options.agentClient.assertConfig(options.config);
  if (options.providerManager === undefined)
    throw new AgentBootstrapError(
      'Initialized Config adoption requires an explicit providerManager owner',
    );
  options.agentClient.assertProviderManager(options.providerManager);
  const preflight = options.activationPreflight?.operation.sessionClient;
  if (
    preflight !== undefined &&
    preflight.getAgentClient() !== options.agentClient
  )
    throw new AgentBootstrapError(
      'Borrowed client differs from the preflight session client',
    );
}

async function cleanupFailedMediaAssembly(
  error: unknown,
  options: FromConfigOptions,
  media: SessionMediaOwner | undefined,
  mcp?: McpRuntimeOwner,
): Promise<never> {
  const clients = await Promise.allSettled([
    options.activationPreflight?.operation.dispose(),
  ]);
  const resources = await Promise.allSettled([
    media?.dispose(),
    ownsMcpRuntime(options) ? mcp?.dispose() : undefined,
  ]);
  const failures = [...clients, ...resources].flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(
      [error, ...failures],
      'Adopted media assembly cleanup failed',
    );
  throw error;
}

async function resolveAdoptedMcpRuntime(
  options: FromConfigOptions,
): Promise<McpRuntimeOwner> {
  if (
    options.mcpRuntime !== undefined &&
    [
      options.lspOwner,
      options.lspOwnership,
      options.filesystemOwner,
      options.filesystemOwnership,
      options.memoryOwner,
    ].some((value) => value !== undefined)
  )
    throw new AgentBootstrapError(
      'An existing MCP handoff already owns its LSP lifetime',
    );
  if (options.lspOwnership === 'caller' && options.lspOwner === undefined)
    throw new AgentBootstrapError(
      'Caller-owned LSP requires an explicit workspace root',
    );
  return (
    options.mcpRuntime ??
    assembleMcpRuntime(
      options.config,
      options.messageBus ?? options.activationPreflight?.operation.messageBus,
      {
        ...options,
        trustPort:
          options.trustPort ??
          options.activationPreflight?.operation.workspaceTrust,
        trustCleanup: options.activationPreflight?.operation.trustCleanup,
        memoryOwner:
          options.memoryOwner ??
          (options.activationPreflight === undefined
            ? undefined
            : {
                owner: options.activationPreflight.operation.workspaceMemory,
                ownership:
                  options.activationPreflight.operation
                    .workspaceMemoryOwnership === 'transferred'
                    ? 'agent'
                    : 'caller',
              }),
        definitionOwner:
          options.definitionOwner ??
          options.activationPreflight?.operation.workspaceDefinitions,
        definitionOwnership:
          options.definitionOwnership ??
          (options.activationPreflight ? 'agent' : undefined),
        filesystemOwner:
          options.filesystemOwner ??
          options.activationPreflight?.operation.workspaceFilesystem,
        filesystemOwnership:
          options.filesystemOwnership ??
          (options.activationPreflight ? 'agent' : undefined),
      },
      options.policyOwner,
      options.policyOwner === undefined ? 'runtime' : 'caller',
      options.settingsOwner,
    )
  );
}
