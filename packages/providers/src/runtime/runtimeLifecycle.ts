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

/**
 * @plan:PLAN-20250218-STATELESSPROVIDER.P06
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement:REQ-SP-005
 * @requirement:REQ-SP4-004
 * @requirement:REQ-SP4-005
 *
 * Runtime lifecycle module - handles setting up and tearing down runtime contexts.
 *
 * @plan:PLAN-20260320-ISSUE1575.P02 - Extracted from runtimeSettings.ts
 */

import {
  type Config,
  DebugLogger,
  type MessageBus,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import {
  createSettingsProviderRuntimeContext,
  setSettingsProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js';
import type {
  SettingsService,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';
import { type OAuthManager } from '../auth/index.js';
import {
  configureProviderRuntimeFactories,
  registerProviderManagerSingleton,
} from '../composition/index.js';
import { registerOAuthRuntimeAccessors } from './oauth-runtime-accessors.js';
import {
  type IsolatedRuntimeActivationOptions,
  type IsolatedRuntimeContextHandle,
  enterRuntimeScope,
} from './runtimeContextFactory.js';
import {
  upsertRuntimeEntry,
  runtimeRegistry,
  resolveActiveRuntimeIdentity,
  setDefaultCliRuntimeId,
} from './runtimeRegistry.js';
import { validateRuntimeId } from './runtimeIdValidation.js';

const logger = new DebugLogger('llxprt:runtime:settings');

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
 * @requirement:REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 7-7
 * Delegate helper that activates an isolated runtime while merging metadata overrides per Step 6.
 */
export async function activateIsolatedRuntimeContext(
  handle: IsolatedRuntimeContextHandle,
  options: IsolatedRuntimeActivationOptions = {},
): Promise<void> {
  const runtimeId = options.runtimeId ?? handle.runtimeId;
  const mergedMetadata = {
    ...handle.metadata,
    ...(options.metadata ?? {}),
  };
  const overrides: IsolatedRuntimeActivationOptions = {
    ...options,
    runtimeId,
    metadata: mergedMetadata,
  };

  enterRuntimeScope({ runtimeId, metadata: mergedMetadata });
  upsertRuntimeEntry(runtimeId, { metadata: mergedMetadata });

  await handle.activate(overrides);
}

/**
 * @plan PLAN-20260630-ISSUE2300
 * Register CLI provider infrastructure (ProviderManager + OAuthManager) on an
 * EXPLICIT runtimeId. The runtimeId is required so identity is never inferred
 * from ambient AsyncLocalStorage state or the registry Map.
 */
export function registerCliProviderInfrastructure(
  manager: RuntimeProviderManager,
  oauthManager: OAuthManager,
  options: {
    messageBus: MessageBus;
    runtimeId: string;
    metadata?: Record<string, unknown>;
    registerAsGlobalSingleton?: boolean;
  },
): void {
  validateRuntimeId(options.runtimeId);
  const { messageBus, runtimeId, metadata } = options;
  const entry = upsertRuntimeEntry(runtimeId, {
    providerManager: manager,
    oauthManager,
    metadata,
  });
  if (options.registerAsGlobalSingleton !== false) {
    registerProviderManagerSingleton(manager as never, oauthManager);
  }

  logger.debug(
    () =>
      `[cli-runtime] registerCliProviderInfrastructure runtimeId=${runtimeId}, messageBus=${messageBus.constructor.name}, registeredRuntimeCount=${runtimeRegistry.size}`,
  );

  const config = entry.config ?? null;
  if (config) {
    configureProviderRuntimeFactories(config, manager);
    manager.setConfig(config);

    logger.debug(
      () =>
        `[cli-runtime] ProviderManager#setConfig applied (loggingEnabled=${config.getConversationLoggingEnabled()})`,
    );
    upsertRuntimeEntry(runtimeId, { config });
  }
}

export function isMissingRuntimeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === 'MissingProviderRuntimeError' ||
    /No active runtime/i.test(error.message) ||
    /MissingProviderRuntimeError/.test(error.message)
  );
}

export function resetCliProviderInfrastructure(runtimeId?: string): void {
  if (runtimeId !== undefined) {
    validateRuntimeId(runtimeId);
  }
  let targetRuntimeId = runtimeId;
  if (targetRuntimeId === undefined) {
    try {
      targetRuntimeId = resolveActiveRuntimeIdentity().runtimeId;
    } catch (error) {
      if (isMissingRuntimeError(error)) {
        return;
      }
      throw error;
    }
  }
  if (!runtimeRegistry.has(targetRuntimeId)) {
    return;
  }

  upsertRuntimeEntry(targetRuntimeId, {
    providerManager: null,
    oauthManager: null,
  });
}

/**
 * @plan PLAN-20260630-ISSUE2300
 * Register or update the active CLI runtime context. `runtimeId` is REQUIRED
 * — callers must supply an explicit, deterministic runtime identity so that
 * resolution never falls back to process-derived or ambient state. When
 * `setAsDefault` is `true` (the default), it also sets the default CLI
 * runtime pointer so identity resolution is deterministic even outside an
 * AsyncLocalStorage scope.
 *
 * Isolated runtime activation MUST pass `setAsDefault: false` so it never
 * overwrites or clears the CLI default pointer (issue #2300).
 */
export function setCliRuntimeContext(
  settingsService: SettingsService,
  config: Config | undefined,
  options: {
    runtimeId: string;
    metadata?: Record<string, unknown>;
    profileManager?: ProfileManager;
    setAsDefault?: boolean;
  },
): void {
  const { runtimeId } = options;
  validateRuntimeId(runtimeId);
  const metadata = { source: 'cli-runtime', ...(options.metadata ?? {}) };
  enterRuntimeScope({ runtimeId, metadata });
  const nextContext = createSettingsProviderRuntimeContext({
    settingsService,
    config,
    runtimeId,
    metadata,
  });
  logger.debug(() => {
    const providerLabel =
      config && typeof config.getProvider === 'function'
        ? ` (provider=${config.getProvider() ?? 'unset'})`
        : '';
    return `[cli-runtime] Registering runtime context ${runtimeId}${providerLabel}`;
  });
  setSettingsProviderRuntimeContext(nextContext);

  upsertRuntimeEntry(runtimeId, {
    settingsService,
    config: config ?? null,
    metadata,
    profileManager: options.profileManager,
  });

  // Set the default CLI runtime pointer so consumers outside an ALS scope
  // (e.g. the UI bridge) resolve THIS runtime deterministically.
  // Isolated runtimes opt out via setAsDefault: false so they never mutate
  // the CLI default pointer.
  if (options.setAsDefault !== false) {
    setDefaultCliRuntimeId(runtimeId);
  }

  // Register the OAuth runtime accessors so the providers-owned auth cluster
  // can read runtime state without importing from the CLI package directly.
  // This is called during every CLI startup (interactive and non-interactive).
  registerOAuthRuntimeAccessors();
}
