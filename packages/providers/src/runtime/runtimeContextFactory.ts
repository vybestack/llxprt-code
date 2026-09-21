/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import { AsyncLocalStorage } from 'node:async_hooks';
/**
 * @plan:PLAN-20250214-CREDPROXY.P33
 */

import {
  type KeyringTokenStore,
  type RuntimeAuthScopeFlushResult,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import {
  type Config,
  createProviderRuntimeContext,
  flushRuntimeAuthScope,
} from '@vybestack/llxprt-code-core';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '../ProviderManager.js';
import { OAuthManager, createTokenStore } from '../auth/index.js';
import { validateRuntimeId } from './runtimeIdValidation.js';
import type { RuntimeKind } from './runtimeRegistry.js';
import { createFileOAuthSettingsProvider } from '../auth/file-oauth-settings.js';
import { registerStandardOAuthProviders } from '../composition/oauth-provider-registration.js';

let sharedTokenStore: KeyringTokenStore | null = null;
let activationBindings: RuntimeActivationBindings | null = null;
let runtimeCounter = 0;

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P15
 * @requirement REQ-SP2-003
 * @pseudocode cli-runtime-isolation.md lines 1-3
 * Async runtime scope ensures each CLI runtime preserves its identity across async boundaries.
 */
export interface RuntimeScopeValue {
  runtimeId: string;
  metadata: Record<string, unknown>;
}

let runtimeScope = new AsyncLocalStorage<RuntimeScopeValue>();

export function enterRuntimeScope(scope: RuntimeScopeValue): void {
  runtimeScope.enterWith(scope);
}

export function runWithRuntimeScope<T>(
  scope: RuntimeScopeValue,
  callback: () => T,
): T {
  return runtimeScope.run(scope, callback);
}

export function getCurrentRuntimeScope(): RuntimeScopeValue | undefined {
  return runtimeScope.getStore();
}
export function resetRuntimeScopeForTesting(): void {
  runtimeScope.disable();
  runtimeScope = new AsyncLocalStorage<RuntimeScopeValue>();
}

interface RuntimeActivationBindings {
  resetInfrastructure: (runtimeId?: string) => void | Promise<void>;
  setRuntimeContext: (
    settingsService: SettingsService,
    config: Config,
    options: {
      metadata?: Record<string, unknown>;
      runtimeId: string;
      profileManager?: ProfileManager;
      setAsDefault?: boolean;
      runtimeKind?: RuntimeKind;
    },
  ) => void | Promise<void>;
  registerInfrastructure: (
    manager: RuntimeProviderManager,
    oauthManager: OAuthManager,
    options: {
      messageBus: MessageBus;
      runtimeId: string;
      metadata?: Record<string, unknown>;
      registerAsGlobalSingleton?: boolean;
      runtimeKind?: RuntimeKind;
    },
  ) => void | Promise<void>;
  linkProviderManager: (
    config: Config,
    manager: RuntimeProviderManager,
  ) => void | Promise<void>;
  disposeRuntime?: (
    runtimeId: string,
    context?: RuntimeAuthScopeFlushResult,
  ) => void | Promise<void>;
}

interface RuntimeActivationState {
  cleanupRequired: boolean;
  currentRuntimeId: string;
  currentMetadata: Record<string, unknown>;
}

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
 * @requirement:REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 7-7
 * Runtime activation overrides that allow callers to adjust metadata and runtimeId per Step 6.
 */
export interface IsolatedRuntimeActivationOptions {
  metadata?: Record<string, unknown>;
  runtimeId?: string;
  runtimeKind?: RuntimeKind;
}

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
 * @requirement:REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 3-4
 * Options for constructing an isolated CLI runtime with dedicated SettingsService/Config instances.
 */
export interface IsolatedRuntimeContextOptions {
  runtimeId?: string;
  runtimeKind?: RuntimeKind;
  metadata?: Record<string, unknown>;
  /**
   * The caller-supplied Config for this runtime (issue #3222). Providers no
   * longer constructs a Config on behalf of agent callers — agent-owned
   * callers (createAgent/fromConfig/subagent orchestrator) build and own
   * their Config through the agent runtime assembly before calling this
   * factory. Required; JavaScript callers that omit it fail fast.
   */
  config: Config;
  oauthManager?: OAuthManager;
  /**
   * Caller-provided shared MessageBus. When supplied, the runtime uses THIS
   * instance as its session bus (so the context-created OAuthManager binds to
   * it) instead of constructing a private one.
   * @plan:PLAN-20260617-COREAPI.P15
   * @requirement:REQ-001
   */
  messageBus?: MessageBus;
  /**
   * Caller-provided provider manager. When supplied, the runtime ADOPTS this
   * instance instead of constructing a private one, so a Config-adopting caller
   * (e.g. agents `fromConfig`) does not create a second manager.
   *
   * CRIT-1: typed as the STRUCTURAL core interface RuntimeProviderManager (not the
   * concrete providers ProviderManager class) so the agents caller can pass
   * Config.getProviderManager() — which returns RuntimeProviderManager | undefined
   * (configBaseCore.ts:265) — with ZERO assertion. The default ProviderManager
   * instance constructed below structurally satisfies this interface.
   * @plan:PLAN-20260621-COREAPIREMED.P03
   * @requirement:REQ-005.2
   */
  providerManager?: RuntimeProviderManager;
  prepare?: (context: {
    config: Config;
    settingsService: SettingsService;
    providerManager: RuntimeProviderManager;
    oauthManager: OAuthManager;
    runtimeId: string;
    metadata: Record<string, unknown>;
  }) => void | Promise<void>;
  onCleanup?: (context: {
    config: Config;
    settingsService: SettingsService;
    providerManager: RuntimeProviderManager;
    runtimeId: string;
    metadata: Record<string, unknown>;
  }) => void | Promise<void>;
}

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
 * @requirement:REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 7-8
 * Handle returned by the factory that exposes activation and cleanup hooks per Steps 6-7.
 */
export interface IsolatedRuntimeContextHandle {
  runtimeId: string;
  metadata: Record<string, unknown>;
  settingsService: SettingsService;
  config: Config;
  providerManager: RuntimeProviderManager;
  oauthManager: OAuthManager;
  activate: (
    options?: IsolatedRuntimeActivationOptions,
  ) => Promise<void> | void;
  cleanup: () => Promise<void> | void;
}

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
 * @requirement:REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 6-6
 * Cache CLI activation bindings (reset/context/infrastructure/link) for deterministic invocation.
 */
export function registerIsolatedRuntimeBindings(
  bindings: RuntimeActivationBindings,
): void {
  activationBindings = bindings;
}

/** Creates the shared token store and OAuthManager for the runtime. */
function resolveOAuthManager(
  sessionMessageBus: MessageBus,
  optionsOAuthManager: OAuthManager | undefined,
  config: Config,
): OAuthManager {
  // @plan:PLAN-20250214-CREDPROXY.P33
  const tokenStore =
    sharedTokenStore ??
    (sharedTokenStore = createTokenStore() as KeyringTokenStore);
  if (optionsOAuthManager) {
    registerStandardOAuthProviders(optionsOAuthManager);
    return optionsOAuthManager;
  }
  const oauthSettings = createFileOAuthSettingsProvider();
  const oauthManager = new OAuthManager(tokenStore, oauthSettings, {
    messageBus: sessionMessageBus,
    config,
  });
  registerStandardOAuthProviders(oauthManager, tokenStore);
  return oauthManager;
}

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
 * @requirement:REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 7-7
 * Execute the activation flow in the reset → context → infrastructure → link order per Step 6.
 */
function buildActivateClosure(
  runtimeId: string,
  baseMetadata: Record<string, unknown>,
  state: RuntimeActivationState,
  resolvedSettingsService: SettingsService,
  config: Config,
  providerManager: RuntimeProviderManager,
  oauthManager: OAuthManager,
  options: IsolatedRuntimeContextOptions,
  sessionMessageBus: MessageBus,
): (activationOptions?: IsolatedRuntimeActivationOptions) => Promise<void> {
  return async (
    activationOptions?: IsolatedRuntimeActivationOptions,
  ): Promise<void> => {
    if (!activationBindings) {
      throw new Error(
        'Isolated runtime activation bindings must be registered before activation.',
      );
    }

    const bindings = activationBindings;

    state.currentRuntimeId = activationOptions?.runtimeId ?? runtimeId;
    validateRuntimeId(state.currentRuntimeId);
    state.currentMetadata = {
      ...baseMetadata,
      ...(activationOptions?.metadata ?? {}),
    };
    state.cleanupRequired = true;

    const scope = {
      runtimeId: state.currentRuntimeId,
      metadata: state.currentMetadata,
    };
    const effectiveRuntimeKind =
      activationOptions?.runtimeKind ?? options.runtimeKind ?? 'agent';

    enterRuntimeScope(scope);

    await runWithRuntimeScope(scope, async () => {
      const scopedRuntime = createProviderRuntimeContext({
        settingsService: resolvedSettingsService,
        config,
        runtimeId: state.currentRuntimeId,
        metadata: state.currentMetadata,
      });
      providerManager.setRuntimeContext(scopedRuntime);

      await Promise.resolve(
        bindings.resetInfrastructure(state.currentRuntimeId),
      );
      await Promise.resolve(
        bindings.setRuntimeContext(resolvedSettingsService, config, {
          runtimeId: state.currentRuntimeId,
          metadata: state.currentMetadata,
          profileManager: config.getProfileManager(),
          // Isolated runtimes MUST NOT mutate the CLI default pointer (issue
          // #2300); only the CLI composition boundary sets the default.
          setAsDefault: false,
          runtimeKind: effectiveRuntimeKind,
        }),
      );

      if (options.prepare) {
        await options.prepare({
          config,
          settingsService: resolvedSettingsService,
          providerManager,
          oauthManager,
          runtimeId: state.currentRuntimeId,
          metadata: state.currentMetadata,
        });
      }

      await Promise.resolve(
        bindings.registerInfrastructure(providerManager, oauthManager, {
          messageBus: sessionMessageBus,
          runtimeId: state.currentRuntimeId,
          metadata: state.currentMetadata,
          registerAsGlobalSingleton: false,
          runtimeKind: effectiveRuntimeKind,
        }),
      );
      await Promise.resolve(
        bindings.linkProviderManager(config, providerManager),
      );
    });
  };
}

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
 * @requirement:REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 8-8
 * Clear activation state and invoke onCleanup hooks in the reverse order detailed in Step 7.
 */
function buildCleanupClosure(
  state: RuntimeActivationState,
  resolvedSettingsService: SettingsService,
  config: Config,
  providerManager: RuntimeProviderManager,
  options: IsolatedRuntimeContextOptions,
): () => Promise<void> {
  return async (): Promise<void> => {
    if (!state.cleanupRequired && !options.onCleanup) {
      return;
    }

    const scope = {
      runtimeId: state.currentRuntimeId,
      metadata: state.currentMetadata,
    };
    const bindings = activationBindings;

    await runWithRuntimeScope(scope, async () => {
      if (bindings) {
        await Promise.resolve(
          bindings.resetInfrastructure(state.currentRuntimeId),
        );
      }

      const revocation: RuntimeAuthScopeFlushResult = flushRuntimeAuthScope(
        state.currentRuntimeId,
      );

      if (options.onCleanup) {
        await options.onCleanup({
          config,
          settingsService: resolvedSettingsService,
          providerManager,
          runtimeId: state.currentRuntimeId,
          metadata: state.currentMetadata,
        });
      }

      if (bindings?.disposeRuntime) {
        await Promise.resolve(
          bindings.disposeRuntime(state.currentRuntimeId, revocation),
        );
      }
    });

    state.cleanupRequired = false;
  };
}

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
 * @requirement:REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 2-5
 * Construct an isolated runtime using shared immutable resources and scoped services.
 */
/**
 * Resolves the isolated runtime's identity: the caller-supplied runtimeId
 * when present (validated), else a freshly generated one; plus the base
 * metadata (caller metadata merged over the factory source tag).
 */
function resolveRuntimeIdentity(options: IsolatedRuntimeContextOptions): {
  runtimeId: string;
  metadata: Record<string, unknown>;
} {
  const runtimeId =
    options.runtimeId ??
    `cli-isolated-${Date.now().toString(16)}-${(runtimeCounter += 1).toString(16)}`;
  validateRuntimeId(runtimeId);
  const metadata = {
    source: 'cli-isolated-runtime-factory',
    ...(options.metadata ?? {}),
  };
  return { runtimeId, metadata };
}

export function createIsolatedRuntimeContext(
  options: IsolatedRuntimeContextOptions,
): IsolatedRuntimeContextHandle {
  if (!activationBindings) {
    throw new Error(
      'Isolated runtime activation bindings must be registered before creating contexts.',
    );
  }
  // Runtime guard for JavaScript callers: the type marks config as required,
  // but a JS caller can omit it. Read through a generic key lookup so the
  // presence check does not trip the no-unnecessary-condition lint the
  // non-optional type would otherwise trigger.
  if (!hasOptionConfig(options, 'config')) {
    throw new Error(
      'createIsolatedRuntimeContext requires a caller-supplied Config: ' +
        'providers no longer constructs a Config for agent callers — build it ' +
        'through the agent-owned runtime assembly first (issue #3222).',
    );
  }

  const { runtimeId, metadata: baseMetadata } = resolveRuntimeIdentity(options);
  const config = options.config;
  // Single resolution path (#2534 C6): the caller-supplied Config's settings
  // service IS the runtime's settings service (Config always carries one).
  const settingsService = config.getSettingsService();

  // @plan:PLAN-20260617-COREAPI.P15
  // @requirement:REQ-001
  // Use the caller-provided bus when present so the context-created
  // OAuthManager binds to the SAME bus the caller shares with the loop.
  const sessionMessageBus =
    options.messageBus ??
    new MessageBus(config.getPolicyEngine(), config.getDebugMode());
  const oauthManager = resolveOAuthManager(
    sessionMessageBus,
    options.oauthManager,
    config,
  );

  const initialRuntimeContext = createProviderRuntimeContext({
    settingsService,
    config,
    runtimeId,
    metadata: baseMetadata,
  });
  const activationState: RuntimeActivationState = {
    cleanupRequired: false,
    currentRuntimeId: runtimeId,
    currentMetadata: baseMetadata,
  };

  // @plan:PLAN-20260621-COREAPIREMED.P05 @requirement:REQ-005.2 @pseudocode lines 10-40
  // Adopt the caller-provided manager when supplied (mirrors the messageBus? adoption
  // at `options.messageBus ?? new MessageBus(...)`); otherwise construct a fresh one.
  const providerManager =
    options.providerManager ??
    new ProviderManager({
      runtime: initialRuntimeContext,
      settingsService,
      config,
    });

  const activate = buildActivateClosure(
    runtimeId,
    baseMetadata,
    activationState,
    settingsService,
    config,
    providerManager,
    oauthManager,
    options,
    sessionMessageBus,
  );

  const cleanup = buildCleanupClosure(
    activationState,
    settingsService,
    config,
    providerManager,
    options,
  );

  return {
    runtimeId,
    metadata: baseMetadata,
    settingsService,
    config,
    providerManager,
    oauthManager,
    activate,
    cleanup,
  };
}

/**
 * Generic presence check for the required `config` option. The option's type
 * is non-optional, so a direct `=== undefined` comparison would trip the
 * no-unnecessary-condition lint; reading through a generic key lookup keeps
 * the runtime guard for JavaScript callers type-safe.
 */
function hasOptionConfig<K extends string>(
  obj: { readonly [P in K]?: unknown },
  key: K,
): boolean {
  const v: unknown = obj[key];
  return v !== null && v !== undefined;
}
