/**
 * @plan:PLAN-20260621-COREAPIREMED.P09
 * @requirement:REQ-001,REQ-005,REQ-INT-001
 * @pseudocode lines 10-78
 *
 * Public config-adoption entry: builds a ready Agent by ADOPTING an
 * existing caller-supplied Config (never constructing a second one) and
 * reusing the SAME shared finalize path createAgent uses (CRIT-4).
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { createAgentRuntimeStateFromConfig } from '@vybestack/llxprt-code-core/runtime/runtimeStateFactory.js';
import { createIsolatedRuntimeContext } from '@vybestack/llxprt-code-providers/runtime.js';
import type { IsolatedRuntimeContextHandle } from '@vybestack/llxprt-code-providers/runtime.js';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { FromConfigOptions } from './config-types.js';
import { FromConfigValidatableSchema } from './config-types.js';
import type { Agent } from './agent.js';
import {
  resolveAgentRuntimeId,
  AgentBootstrapError,
} from './agentBootstrap.js';
import { executeProviderActivation } from './providerActivationExecutor.js';
import { consumeCompletedActivationPreflight } from './activationPreflightState.js';
import {
  finalizeAgent,
  registerProvidersOntoManager,
  requirePostAuthClient,
} from './createAgent.js';
import {
  ensureAgentRuntimeFactories,
  ensureRuntimeManagers,
  createAgentSessionExecution,
  createSessionApprovalBus,
  bindSessionTaskTools,
  createSessionAgentClient,
  bindSessionSurfaceUpdates,
  type SessionTaskServices,
  type SessionSchedulerOwner,
  cleanupFailedRuntimeBootstrap,
} from './agentRuntimeAssembly.js';
import { wireMcpHostServices } from './mcpHostWiring.js';
import { registerActivateSkillTool } from '../skill-tool-registrar.js';

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
 * should invoke {@link executeProviderActivation} directly against the Config
 * BEFORE calling fromConfig (without the activation option); this keeps
 * fromConfig's existing callers (nonInteractiveCli.ts) working unchanged while
 * exposing the typed result surface on the executor.
 *
 * @plan:PLAN-20260621-COREAPIREMED.P09
 * @requirement:REQ-001,REQ-005,REQ-INT-001
 * @pseudocode lines 10-48
 */
export async function fromConfig(options: FromConfigOptions): Promise<Agent> {
  wireMcpHostServices();
  // @pseudocode lines 11-13: validate presence + the small validatable portion.
  // The FromConfigOptions type marks config as required, but at runtime callers
  // may omit it (T1d); read through a generic presence check so the lint
  // accepts the runtime-undefined check without an unsafe assertion.
  if (!hasConfig(options, 'config')) {
    throw new AgentBootstrapError('fromConfig requires an existing Config');
  }
  FromConfigValidatableSchema.parse({
    sessionId: options.sessionId,
    activation: options.activation,
  });

  // @pseudocode line 14: ADOPT — never construct.
  const config: Config = options.config;

  // Agent-owned assembly (issue #3222): install the client and task
  // registration defaults only where absent, plus the runtime managers.
  // The client factory must be present before activation/refreshAuth. The
  // scheduler factory is passed directly to session execution below.
  ensureAgentRuntimeFactories(config);
  ensureRuntimeManagers(config);

  // @pseudocode line 15: runtimeId (sessionId takes precedence; otherwise generate).
  const runtimeId = resolveAgentRuntimeId(options.sessionId);

  // Borrow the explicit caller bus, or create a bus owned by this Agent.
  const approvalBus = createSessionApprovalBus(config, options.messageBus);
  const { messageBus } = approvalBus;

  // @pseudocode lines 20-28: adopt the runtime context (NOT a second manager).
  const handle = adoptRuntimeContext(config, runtimeId, messageBus);
  const { tasks: taskServices, schedulerOwner } = createAgentSessionExecution(
    config,
    handle.settingsService,
    options.toolSchedulerFactory,
  );
  let sessionClient: AgentClientContract | undefined;

  try {
    await handle.activate();
    await initializeAdoptedConfig(
      config,
      messageBus,
      taskServices,
      schedulerOwner,
    );

    // @plan:PLAN-20270104-ISSUE2374.P03 @requirement:REQ-001
    await resolveActivation(config, options);
    requirePostAuthClient(config);

    // @pseudocode lines 37-48 (Mismatch 1): synthesize parsed + resolvedAuth.
    const parsed = buildParsedConfig(config, options);
    await config
      .getTokenizerFactory()
      ?.prepareTokenizer?.(parsed.provider, parsed.model);
    const resolvedAuth = { baseUrl: undefined };
    sessionClient = await createSessionAgentClient(
      config,
      schedulerOwner.getToolRegistry(),
      createAgentRuntimeStateFromConfig(config, { runtimeId }),
    );
    bindSessionSurfaceUpdates(
      config,
      messageBus,
      taskServices,
      schedulerOwner,
      sessionClient,
    );

    // @pseudocode lines 37-48: SHARED finalize (CRIT-4: single finalize path).
    // The 17th positional arg 'caller' threads REQ-001.3 ownership so dispose()
    // skips the caller-owned Config teardown.
    return await finalizeAgent(
      parsed,
      resolvedAuth,
      config,
      handle.providerManager,
      resolveOAuthManager(config, handle),
      handle.settingsService,
      runtimeId,
      handle,
      messageBus,
      options.onApproval,
      options.onOAuthPrompt,
      options.editorCallbacks,
      [],
      'caller',
      taskServices,
      schedulerOwner,
      approvalBus,
      sessionClient,
    );
  } catch (primaryError) {
    // Release the session-owned runtime and task services while preserving the
    // adopted Config, which remains the caller's responsibility (REQ-001.3).
    return cleanupFailedRuntimeBootstrap(handle, primaryError, 'fromConfig', {
      taskServices,
      schedulerOwner,
      approvalBus,
      ...(sessionClient !== undefined ? { sessionClient } : {}),
    });
  }
}

function adoptRuntimeContext(
  config: Config,
  runtimeId: string,
  messageBus: MessageBus,
): IsolatedRuntimeContextHandle {
  return createIsolatedRuntimeContext({
    runtimeId,
    config,
    messageBus,
    providerManager: config.getProviderManager(),
    prepare: (ctx) =>
      registerProvidersOntoManager(ctx.providerManager, ctx, ctx.config),
  });
}

async function initializeAdoptedConfig(
  config: Config,
  messageBus: MessageBus,
  taskServices: SessionTaskServices,
  schedulerOwner: SessionSchedulerOwner,
): Promise<void> {
  const hadRegistrar = Boolean(config.getPostSkillDiscoveryToolRegistrar());
  if (!hadRegistrar) {
    config.setPostSkillDiscoveryToolRegistrar(registerActivateSkillTool);
  }
  await config.ensureInitialized({
    messageBus,
    taskManager: taskServices.manager,
    shellJobs: taskServices.shellJobs,
  });
  if (!hadRegistrar) {
    await config
      .getSkillManager()
      .discoverSkills(config.storage, config.getExtensions());
  }
  await config.refreshMemory();
  await bindSessionTaskTools(
    config,
    messageBus,
    taskServices.manager,
    schedulerOwner,
    taskServices.shellJobs,
  );
}

/**
 * Finding 3 (#2378): adopt the EXACT assembled OAuthManager from the Config's
 * runtime bundle when available. Falls back to the isolated-runtime handle's
 * OAuthManager when no Config-associated runtime bundle was attached (e.g. Zed).
 */
function resolveOAuthManager(
  config: Config,
  handle: IsolatedRuntimeContextHandle,
): OAuthManager {
  const runtimeOAuthManager = config.getRuntimeOAuthManager();
  return runtimeOAuthManager instanceof OAuthManager
    ? runtimeOAuthManager
    : handle.oauthManager;
}

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
): Promise<void> {
  if (options.activation !== undefined) {
    const activationResult =
      options.activationPreflightToken !== undefined
        ? consumeCompletedActivationPreflight(
            config,
            options.activationPreflightToken,
            options.activation,
          )
        : await executeProviderActivation(config, options.activation);
    if (activationResult.authFailed) {
      const underlying = activationResult.authError;
      throw new AgentBootstrapError(
        `fromConfig activation failed: ${
          underlying instanceof Error ? underlying.message : String(underlying)
        }`,
        { cause: underlying },
      );
    }
  } else if (!hasPostAuthClient(config)) {
    // Construct the auth client for an already-activated Config.
    await config.refreshAuth(undefined);
  }
}

/**
 * Derive the provider from the post-activation runtime truth, falling back to
 * the Config only when the adopted manager has no active provider.
 */
function buildParsedConfig(
  config: Config,
  options: FromConfigOptions,
): { provider: string; model: string; sessionId?: string } {
  const activeRuntimeProvider =
    config.getProviderManager()?.getActiveProviderName() ??
    config.getProvider();
  return {
    provider: activeRuntimeProvider ?? '',
    model: config.getModel(),
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

/**
 * Public readiness signal: the Config's agent client is present and reports
 * initialized. Config has no public isInitialized() accessor; the only public
 * signal is getAgentClient() (whose field is definite-assignment, so it is
 * runtime-undefined before initialize() despite the non-nullable return type).
 *
 * @plan:PLAN-20260621-COREAPIREMED.P09
 * @requirement:REQ-001
 * @pseudocode lines 73-75
 */
export function isConfigInitialized(config: Config): boolean {
  const client: AgentClientContract | undefined = readAgentClient(config);
  return client?.isInitialized() === true;
}

/**
 * Post-auth client presence: the agent client is present and initialized.
 * Same readiness signal as {@link isConfigInitialized}.
 *
 * @plan:PLAN-20260621-COREAPIREMED.P09
 * @requirement:REQ-001
 * @pseudocode lines 76-78
 */
function hasPostAuthClient(config: Config): boolean {
  const client: AgentClientContract | undefined = readAgentClient(config);
  return client?.isInitialized() === true;
}

/**
 * Reads the Config's agent client into a typed local so the optional-chain
 * guard compiles under the no-unnecessary-condition lint (getAgentClient()'s
 * return type is non-nullable but the backing field is definite-assignment and
 * runtime-undefined before initialize()). Returns undefined when the field is
 * not yet populated.
 *
 * @plan:PLAN-20260621-COREAPIREMED.P09
 * @requirement:REQ-001
 */
function readAgentClient(config: Config): AgentClientContract | undefined {
  const client: AgentClientContract = config.getAgentClient();
  return typeof client === 'undefined' ? undefined : client;
}
