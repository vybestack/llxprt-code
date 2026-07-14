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
import type { IsolatedRuntimeContextHandle } from '@vybestack/llxprt-code-providers/runtime.js';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import { activateSettingsRuntimeContext } from '@vybestack/llxprt-code-core';
import type { FromConfigOptions } from './config-types.js';
import { FromConfigValidatableSchema } from './config-types.js';
import type { Agent } from './agent.js';
import {
  generateRuntimeId,
  AgentBootstrapError,
  validateAgentRuntimeId,
} from './agentBootstrap.js';
import { executeProviderActivation } from './providerActivationExecutor.js';
import { consumeCompletedActivationPreflight } from './activationPreflightState.js';
import { finalizeAgent, registerProvidersOntoManager } from './createAgent.js';

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

  // @pseudocode line 15: runtimeId (sessionId takes precedence; otherwise generate).
  const runtimeId = options.sessionId ?? generateRuntimeId();
  validateAgentRuntimeId(runtimeId);

  // @pseudocode line 16: reach the Config's SettingsService (no second store).
  const settingsService = config.getSettingsService();

  // Adopt an explicit caller bus first, then the Config's assembled runtime bus.
  // Only non-CLI consumers without either seam receive a newly owned bus.
  const messageBus = resolveMessageBus(
    options.messageBus ?? config.getRuntimeMessageBus(),
    config,
  );

  // @pseudocode line 18 (CRIT-1): adopt the Config's existing manager.
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
  const oauthManager = resolveOAuthManager(config, handle);
  const sharedSettingsService = handle.settingsService;

  // @plan:PLAN-20270110-ISSUE2378.P02 @requirement:REQ-2378-002
  // Bind the settings runtime context to the adopted Config's SettingsService.
  activateSettingsRuntimeContext(sharedSettingsService, runtimeId, {
    config,
    metadata: { source: 'fromConfig' },
  });

  // @pseudocode lines 31-35: initialize once or adopt the original result.
  await config.ensureInitialized({ messageBus });

  // @plan:PLAN-20270104-ISSUE2374.P03 @requirement:REQ-001
  await resolveActivation(config, options);

  // @pseudocode lines 37-48 (Mismatch 1): synthesize parsed + resolvedAuth.
  const parsed = buildParsedConfig(config, options);
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
    await config.refreshAuth(undefined);
  }
}

/**
 * #2374 round-3 Fix 1: derive the provider from the POST-activation runtime
 * truth (manager active provider name), NOT config.getProvider(). When no
 * activation intent ran, config.getProvider() is the correct source.
 */
function buildParsedConfig(
  config: Config,
  options: FromConfigOptions,
): { provider: string; model: string; sessionId?: string } {
  const activeRuntimeProvider =
    options.activation !== undefined
      ? (config.getProviderManager()?.getActiveProviderName() ??
        config.getProvider())
      : config.getProvider();
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
