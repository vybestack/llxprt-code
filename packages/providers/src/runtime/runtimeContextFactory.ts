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
import * as path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
/**
 * @plan:PLAN-20250214-CREDPROXY.P33
 */

import {
  Config,
  type KeyringTokenStore,
  MessageBus,
  flushRuntimeAuthScope,
  type RuntimeAuthScopeFlushResult,
  SubagentManager,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { AgentClientFactory } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ToolSchedulerFactory } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import type { TaskToolRegistration } from '@vybestack/llxprt-code-core/config/toolRegistryFactory.js';
import {
  clearSettingsProviderRuntimeContext,
  createSettingsProviderRuntimeContext,
  resolveRuntimeSettingsService,
} from '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '../ProviderManager.js';
import { OAuthManager, createTokenStore } from '../auth/index.js';
import { createFileOAuthSettingsProvider } from '../auth/file-oauth-settings.js';

const DEFAULT_MODEL = 'gemini-1.5-flash';
const DEFAULT_DEBUG_MODE = false;

/**
 * Dependency-inversion seam for agent runtime factories.
 *
 * The concrete implementations (AgentClient, CoreToolScheduler,
 * createTaskToolRegistration) live in `@vybestack/llxprt-code-agents`, which
 * depends on this package. Importing them here would create a providers→agents
 * dependency cycle. Instead, the composition root (the CLI) registers the
 * concrete factories at bootstrap via `registerAgentRuntimeFactories`.
 */
export interface AgentRuntimeFactoryBindings {
  agentClientFactory: AgentClientFactory;
  toolSchedulerFactory: ToolSchedulerFactory;
  taskToolRegistration: () => TaskToolRegistration;
}

let agentRuntimeFactoryBindings: AgentRuntimeFactoryBindings | null = null;

export function registerAgentRuntimeFactories(
  bindings: AgentRuntimeFactoryBindings,
): void {
  agentRuntimeFactoryBindings = bindings;
}

export function resetAgentRuntimeFactories(): void {
  agentRuntimeFactoryBindings = null;
}

function attachAgentRuntimeFactories(config: Config): void {
  if (!agentRuntimeFactoryBindings) {
    // No-op when bindings are unregistered. This is intentional and safe:
    //   - In production the CLI composition root registers the concrete
    //     factories at module load (configBuilder.ts) AND passes them directly
    //     into `new Config({...})`, so this path is always populated.
    //   - The only callers of `createIsolatedRuntimeContext` that may reach
    //     here without bindings are providers-side tests, which cannot register
    //     concrete agent factories without reintroducing a providers→agents
    //     cycle. Those tests never drive an agent-client/scheduler through this
    //     Config.
    //   - If an agent client/scheduler is ever needed without a factory, core
    //     fails fast at the point of use (Config.requireAgentClientFactory
    //     throws "agentClientFactory is required ..."), so a missing binding
    //     surfaces as a clear error rather than silent incorrect behavior.
    return;
  }
  if (config.getToolSchedulerFactory() === undefined) {
    config.setToolSchedulerFactory(
      agentRuntimeFactoryBindings.toolSchedulerFactory,
    );
  }
  if (config.getAgentClientFactory() === undefined) {
    config.setAgentClientFactory(
      agentRuntimeFactoryBindings.agentClientFactory,
    );
  }
  if (config.getTaskToolRegistration() === undefined) {
    config.setTaskToolRegistration(
      agentRuntimeFactoryBindings.taskToolRegistration(),
    );
  }
}

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

const runtimeScope = new AsyncLocalStorage<RuntimeScopeValue>();

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

interface RuntimeActivationBindings {
  resetInfrastructure: () => void | Promise<void>;
  setRuntimeContext: (
    settingsService: SettingsService,
    config: Config,
    options: {
      metadata?: Record<string, unknown>;
      runtimeId: string;
    },
  ) => void | Promise<void>;
  registerInfrastructure: (
    manager: RuntimeProviderManager,
    oauthManager: OAuthManager,
    options: { messageBus: MessageBus },
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
  active: boolean;
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
}

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
 * @requirement:REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 3-4
 * Options for constructing an isolated CLI runtime with dedicated SettingsService/Config instances.
 */
export interface IsolatedRuntimeContextOptions {
  runtimeId?: string;
  metadata?: Record<string, unknown>;
  settingsService?: SettingsService;
  config?: Config;
  model?: string;
  debugMode?: boolean;
  workspaceDir?: string;
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

/** Builds the Config and ensures ProfileManager/SubagentManager are attached. */
function resolveRuntimeConfig(
  options: IsolatedRuntimeContextOptions,
  runtimeId: string,
  settingsService: SettingsService,
): Config {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const model = options.model ?? DEFAULT_MODEL;
  const debugMode = options.debugMode ?? DEFAULT_DEBUG_MODE;

  const config =
    options.config ??
    new Config({
      sessionId: runtimeId,
      targetDir: workspaceDir,
      debugMode,
      cwd: workspaceDir,
      model,
      settingsService,
    });

  // @plan PLAN-20260610-ISSUE1592.P01
  // @requirement REQ-INV-001, REQ-INV-002, REQ-INV-003
  // Agent runtime factories are injected via the dependency-inversion seam
  // (registerAgentRuntimeFactories) to avoid a providers→agents cycle.
  attachAgentRuntimeFactories(config);

  const llxprtDir = Storage.getGlobalConfigDir();
  const resolvedProfileManager =
    config.getProfileManager() ??
    new ProfileManager(path.join(llxprtDir, 'profiles'));
  const resolvedSubagentManager =
    config.getSubagentManager() ??
    new SubagentManager(
      path.join(llxprtDir, 'subagents'),
      resolvedProfileManager,
    );

  config.setProfileManager(resolvedProfileManager);
  config.setSubagentManager(resolvedSubagentManager);
  return config;
}

/** Creates the shared token store and OAuthManager for the runtime. */
function resolveOAuthManager(
  sessionMessageBus: MessageBus,
  optionsOAuthManager: OAuthManager | undefined,
): OAuthManager {
  // @plan:PLAN-20250214-CREDPROXY.P33
  const tokenStore =
    sharedTokenStore ??
    (sharedTokenStore = createTokenStore() as KeyringTokenStore);
  const oauthSettings = createFileOAuthSettingsProvider();
  return (
    optionsOAuthManager ??
    new OAuthManager(tokenStore, oauthSettings, {
      messageBus: sessionMessageBus,
    })
  );
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
    state.currentMetadata = {
      ...baseMetadata,
      ...(activationOptions?.metadata ?? {}),
    };

    const scope = {
      runtimeId: state.currentRuntimeId,
      metadata: state.currentMetadata,
    };

    enterRuntimeScope(scope);

    await runWithRuntimeScope(scope, async () => {
      const scopedRuntime = createSettingsProviderRuntimeContext({
        settingsService: resolvedSettingsService,
        config,
        runtimeId: state.currentRuntimeId,
        metadata: state.currentMetadata,
      });
      providerManager.setRuntimeContext(scopedRuntime);

      await Promise.resolve(bindings.resetInfrastructure());
      await Promise.resolve(
        bindings.setRuntimeContext(resolvedSettingsService, config, {
          runtimeId: state.currentRuntimeId,
          metadata: state.currentMetadata,
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
        }),
      );
      await Promise.resolve(
        bindings.linkProviderManager(config, providerManager),
      );

      state.active = true;
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
    if (!state.active && !options.onCleanup) {
      return;
    }

    const scope = {
      runtimeId: state.currentRuntimeId,
      metadata: state.currentMetadata,
    };
    const bindings = activationBindings;

    await runWithRuntimeScope(scope, async () => {
      if (bindings) {
        await Promise.resolve(bindings.resetInfrastructure());
      }
      clearSettingsProviderRuntimeContext();

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

    state.active = false;
  };
}

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
 * @requirement:REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 2-5
 * Construct an isolated runtime using shared immutable resources and scoped services.
 */
export function createIsolatedRuntimeContext(
  options: IsolatedRuntimeContextOptions = {},
): IsolatedRuntimeContextHandle {
  if (!activationBindings) {
    throw new Error(
      'Isolated runtime activation bindings must be registered before creating contexts.',
    );
  }

  const runtimeId =
    options.runtimeId ??
    `cli-isolated-${Date.now().toString(16)}-${(runtimeCounter += 1).toString(16)}`;

  const baseMetadata = {
    source: 'cli-isolated-runtime-factory',
    ...(options.metadata ?? {}),
  };
  const settingsService =
    options.config?.getSettingsService() ??
    resolveRuntimeSettingsService(options.settingsService);

  const config = resolveRuntimeConfig(options, runtimeId, settingsService);
  const resolvedSettingsService = config.getSettingsService();
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
  );

  const initialRuntimeContext = createSettingsProviderRuntimeContext({
    settingsService: resolvedSettingsService,
    config,
    runtimeId,
    metadata: baseMetadata,
  });
  const activationState: RuntimeActivationState = {
    active: false,
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
      settingsService: resolvedSettingsService,
      config,
    });

  const activate = buildActivateClosure(
    runtimeId,
    baseMetadata,
    activationState,
    resolvedSettingsService,
    config,
    providerManager,
    oauthManager,
    options,
    sessionMessageBus,
  );

  const cleanup = buildCleanupClosure(
    activationState,
    resolvedSettingsService,
    config,
    providerManager,
    options,
  );

  return {
    runtimeId,
    metadata: baseMetadata,
    settingsService: resolvedSettingsService,
    config,
    providerManager,
    oauthManager,
    activate,
    cleanup,
  };
}
