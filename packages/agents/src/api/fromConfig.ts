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
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { createIsolatedRuntimeContext } from '@vybestack/llxprt-code-providers/runtime.js';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { FromConfigOptions } from './config-types.js';
import { FromConfigValidatableSchema } from './config-types.js';
import type { Agent } from './agent.js';
import { generateRuntimeId, AgentBootstrapError } from './agentBootstrap.js';
import { finalizeAgent, registerProvidersOntoManager } from './createAgent.js';

/**
 * Adopts an existing caller-supplied Config and returns a ready Agent.
 *
 * Mirrors createAgent's finalize path WITHOUT re-constructing a Config,
 * ProviderManager, or (when a caller bus is supplied) a MessageBus. The
 * returned Agent's dispose() skips the caller-owned Config teardown
 * (REQ-001.3).
 *
 * @plan:PLAN-20260621-COREAPIREMED.P09
 * @requirement:REQ-001,REQ-005,REQ-INT-001
 * @pseudocode lines 10-48
 */
export async function fromConfig(options: FromConfigOptions): Promise<Agent> {
  // @pseudocode lines 11-13: validate presence + the small validatable portion.
  // The FromConfigOptions type marks config as required, but at runtime callers
  // may omit it (T1d); read through a generic presence check so the lint
  // accepts the runtime-undefined check without an unsafe assertion.
  if (!hasConfig(options, 'config')) {
    throw new AgentBootstrapError('fromConfig requires an existing Config');
  }
  FromConfigValidatableSchema.parse({ sessionId: options.sessionId });

  // @pseudocode line 14: ADOPT — never construct.
  const config: Config = options.config;

  // @pseudocode line 15: runtimeId (sessionId takes precedence; otherwise generate).
  const runtimeId = options.sessionId ?? generateRuntimeId();

  // @pseudocode line 16: reach the Config's SettingsService (no second store).
  const settingsService = config.getSettingsService();

  // @pseudocode line 17 / lines 63-72: adopt the caller bus, else build one.
  const messageBus = resolveMessageBus(options.messageBus, config);

  // @pseudocode line 18 (CRIT-1): adopt the Config's existing manager with
  // ZERO assertion — getProviderManager() returns RuntimeProviderManager |
  // undefined, exactly the providerManager? option's type.
  const adoptedManager: RuntimeProviderManager | undefined =
    config.getProviderManager();

  // @pseudocode lines 20-28: adopt the runtime context (NOT a second manager).
  const handle = createIsolatedRuntimeContext({
    runtimeId,
    settingsService,
    config,
    messageBus,
    providerManager: adoptedManager,
    model: config.getModel(),
    prepare: (ctx) => {
      registerProvidersOntoManager(ctx.providerManager, ctx, ctx.config);
    },
  });

  // @pseudocode line 29: activate so getCliRuntimeServices() resolves THESE.
  await handle.activate();

  // @pseudocode line 37-48 (createAgent.ts:178-180 mirror): derive managers.
  const manager = handle.providerManager;
  const oauthManager = handle.oauthManager;
  const sharedSettingsService = handle.settingsService;

  // @pseudocode lines 31-35: conditional init/auth (skip if already done).
  // The adopted Config's initialize() guard throws "Config was already
  // initialized" when called twice; an adopted CLI-style Config is typically
  // already initialized. Wrap initialize() so the already-initialized state is
  // treated as "skip" rather than failing the adoption.
  if (!isConfigInitialized(config)) {
    await safeInitialize(config, messageBus);
  }
  if (!hasPostAuthClient(config)) {
    // resolveAuthForAdoptedConfig: refreshAuth accepts an optional authMethod
    // string; pass undefined so the adopted Config re-derives it internally.
    await config.refreshAuth(undefined);
  }

  // @pseudocode lines 37-48 (Mismatch 1): synthesize parsed + resolvedAuth.
  const parsed = {
    provider: config.getProvider() ?? '',
    model: config.getModel(),
    ...(options.sessionId !== undefined
      ? { sessionId: options.sessionId }
      : {}),
  };
  const resolvedAuth = { baseUrl: undefined };

  // @pseudocode lines 37-48: SHARED finalize (CRIT-4: single finalize path).
  // The 17th positional arg 'caller' threads REQ-001.3 ownership so dispose()
  // skips the caller-owned Config teardown.
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
    options.onApproval,
    options.onOAuthPrompt,
    options.editorCallbacks,
    [],
    'caller',
  );
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
 * Adopts the caller-supplied bus when present; otherwise builds ONE bus from
 * the Config's policy engine exactly as createAgent does today. NEVER reads a
 * bus back off the Config (it has no getMessageBus accessor — CRIT-2).
 *
 * @plan:PLAN-20260621-COREAPIREMED.P09
 * @requirement:REQ-001,REQ-005
 * @pseudocode lines 63-72
 */
function resolveMessageBus(
  callerBus: MessageBus | undefined,
  config: Config,
): MessageBus {
  if (callerBus !== undefined) {
    return callerBus;
  }
  return new MessageBus(config.getPolicyEngine(), config.getDebugMode());
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
function isConfigInitialized(config: Config): boolean {
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

/**
 * Attempts initialize() and swallows the "Config was already initialized"
 * error so an already-initialized adopted Config is not double-initialized.
 * The isConfigInitialized() public signal is best-effort (the client's
 * isInitialized() tracks chat readiness, not Config.initialize()'s private
 * flag), so this guard is the reliable backstop.
 *
 * @plan:PLAN-20260621-COREAPIREMED.P09
 * @requirement:REQ-001
 * @pseudocode lines 31-32
 */
async function safeInitialize(
  config: Config,
  messageBus: MessageBus,
): Promise<void> {
  try {
    await config.initialize({ messageBus });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'Config was already initialized') {
      return;
    }
    throw e;
  }
}
