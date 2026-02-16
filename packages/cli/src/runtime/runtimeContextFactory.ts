/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  Config,
  KeyringTokenStore,
  ProviderManager,
  SettingsService,
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
  flushRuntimeAuthScope,
  type RuntimeAuthScopeFlushResult,
  ProfileManager,
  SubagentManager,
} from '@vybestack/llxprt-code-core';
import { OAuthManager } from '../auth/oauth-manager.js';
import { LoadedSettings, USER_SETTINGS_PATH } from '../config/settings.js';
import type { Settings } from '../config/settings.js';
import stripJsonComments from 'strip-json-comments';

const DEFAULT_MODEL = 'gemini-1.5-flash';
const DEFAULT_DEBUG_MODE = false;

/**
 * @fix issue1317
 * Load user settings from disk so isolated runtimes can resolve oauthEnabledProviders.
 * Follows the same pattern as resolveLoadedSettings() in providerManagerInstance.ts.
 */
function loadSettingsForIsolatedRuntime(): LoadedSettings | undefined {
  try {
    if (fs.existsSync(USER_SETTINGS_PATH)) {
      const userContent = fs.readFileSync(USER_SETTINGS_PATH, 'utf-8');
      const userSettings = JSON.parse(
        stripJsonComments(userContent),
      ) as Settings;
      return new LoadedSettings(
        { path: '', settings: {} as Settings },
        { path: '', settings: {} as Settings },
        { path: USER_SETTINGS_PATH, settings: userSettings },
        { path: '', settings: {} as Settings },
        true,
      );
    }
  } catch {
    // Failed to load user settings; fall back to no settings.
  }
  return undefined;
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
    manager: ProviderManager,
    oauthManager: OAuthManager,
  ) => void | Promise<void>;
  linkProviderManager: (
    config: Config,
    manager: ProviderManager,
  ) => void | Promise<void>;
  disposeRuntime?: (
    runtimeId: string,
    context?: RuntimeAuthScopeFlushResult,
  ) => void | Promise<void>;
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
  prepare?: (context: {
    config: Config;
    settingsService: SettingsService;
    providerManager: ProviderManager;
    oauthManager: OAuthManager;
    runtimeId: string;
    metadata: Record<string, unknown>;
  }) => void | Promise<void>;
  onCleanup?: (context: {
    config: Config;
    settingsService: SettingsService;
    providerManager: ProviderManager;
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
  providerManager: ProviderManager;
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

  const workspaceDir = options.workspaceDir ?? process.cwd();
  const baseMetadata = {
    source: 'cli-isolated-runtime-factory',
    ...(options.metadata ?? {}),
  };
  const settingsService =
    options.config?.getSettingsService() ??
    options.settingsService ??
    new SettingsService();

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

  const configWithManagers = config as Config & {
    getProfileManager?: () => ProfileManager | undefined;
    setProfileManager?: (manager: ProfileManager) => void;
    getSubagentManager?: () => SubagentManager | undefined;
    setSubagentManager?: (manager: SubagentManager) => void;
  };
  const optionsConfigWithManagers = options.config as
    | (Config & {
        getProfileManager?: () => ProfileManager | undefined;
        getSubagentManager?: () => SubagentManager | undefined;
      })
    | undefined;

  const llxprtDir = path.join(os.homedir(), '.llxprt');
  const resolvedProfileManager =
    optionsConfigWithManagers?.getProfileManager?.() ??
    configWithManagers.getProfileManager?.() ??
    new ProfileManager(path.join(llxprtDir, 'profiles'));
  const resolvedSubagentManager =
    optionsConfigWithManagers?.getSubagentManager?.() ??
    configWithManagers.getSubagentManager?.() ??
    new SubagentManager(
      path.join(llxprtDir, 'subagents'),
      resolvedProfileManager,
    );

  configWithManagers.setProfileManager?.(resolvedProfileManager);
  configWithManagers.setSubagentManager?.(resolvedSubagentManager);

  const resolvedSettingsService =
    config.getSettingsService() ?? settingsService;
  const tokenStore =
    sharedTokenStore ?? (sharedTokenStore = new KeyringTokenStore()); // Step 1 (multi-runtime-baseline.md line 2) keeps token storage shared.
  const oauthManager =
    options.oauthManager ??
    new OAuthManager(tokenStore, loadSettingsForIsolatedRuntime());

  const initialRuntimeContext = createProviderRuntimeContext({
    settingsService: resolvedSettingsService,
    config,
    runtimeId,
    metadata: baseMetadata,
  });

  const providerManager = new ProviderManager({
    runtime: initialRuntimeContext,
    settingsService: resolvedSettingsService,
    config,
  });

  let currentRuntimeId = runtimeId;
  let currentMetadata = baseMetadata;
  let active = false;

  /**
   * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
   * @requirement:REQ-SP2-002
   * @pseudocode multi-runtime-baseline.md lines 7-7
   * Execute the activation flow in the reset → context → infrastructure → link order per Step 6.
   */
  const activate = async (
    activationOptions?: IsolatedRuntimeActivationOptions,
  ): Promise<void> => {
    if (!activationBindings) {
      throw new Error(
        'Isolated runtime activation bindings must be registered before activation.',
      );
    }

    const bindings = activationBindings;

    currentRuntimeId = activationOptions?.runtimeId ?? runtimeId;
    currentMetadata = {
      ...baseMetadata,
      ...(activationOptions?.metadata ?? {}),
    };

    const scope = {
      runtimeId: currentRuntimeId,
      metadata: currentMetadata,
    };

    enterRuntimeScope(scope);

    await runWithRuntimeScope(scope, async () => {
      const scopedRuntime = createProviderRuntimeContext({
        settingsService: resolvedSettingsService,
        config,
        runtimeId: currentRuntimeId,
        metadata: currentMetadata,
      });
      (
        providerManager as unknown as { runtime?: ProviderRuntimeContext }
      ).runtime = scopedRuntime;

      await Promise.resolve(bindings.resetInfrastructure());
      await Promise.resolve(
        bindings.setRuntimeContext(resolvedSettingsService, config, {
          runtimeId: currentRuntimeId,
          metadata: currentMetadata,
        }),
      );

      if (options.prepare) {
        await options.prepare({
          config,
          settingsService: resolvedSettingsService,
          providerManager,
          oauthManager,
          runtimeId: currentRuntimeId,
          metadata: currentMetadata,
        });
      }

      await Promise.resolve(
        bindings.registerInfrastructure(providerManager, oauthManager),
      );
      await Promise.resolve(
        bindings.linkProviderManager(config, providerManager),
      );

      active = true;
    });
  };

  /**
   * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
   * @requirement:REQ-SP2-002
   * @pseudocode multi-runtime-baseline.md lines 8-8
   * Clear activation state and invoke onCleanup hooks in the reverse order detailed in Step 7.
   */
  const cleanup = async (): Promise<void> => {
    if (!active && !options.onCleanup) {
      return;
    }

    const scope = {
      runtimeId: currentRuntimeId,
      metadata: currentMetadata,
    };
    const bindings = activationBindings;

    await runWithRuntimeScope(scope, async () => {
      if (bindings) {
        await Promise.resolve(bindings.resetInfrastructure());
      }
      clearActiveProviderRuntimeContext();

      const revocation: RuntimeAuthScopeFlushResult =
        flushRuntimeAuthScope(currentRuntimeId);

      if (options.onCleanup) {
        await options.onCleanup({
          config,
          settingsService: resolvedSettingsService,
          providerManager,
          runtimeId: currentRuntimeId,
          metadata: currentMetadata,
        });
      }

      if (bindings?.disposeRuntime) {
        await Promise.resolve(
          bindings.disposeRuntime(currentRuntimeId, revocation),
        );
      }
    });

    active = false;
  };

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
