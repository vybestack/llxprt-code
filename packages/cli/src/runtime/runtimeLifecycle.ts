/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
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
  type SettingsService,
  type ProfileManager,
  type MessageBus,
  type ProviderManager,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import type { OAuthManager } from '../auth/oauth-manager.js';
import { registerProviderManagerSingleton } from '../providers/providerManagerInstance.js';
import {
  type IsolatedRuntimeActivationOptions,
  type IsolatedRuntimeContextHandle,
  enterRuntimeScope,
} from './runtimeContextFactory.js';
import {
  upsertRuntimeEntry,
  resolveActiveRuntimeIdentity,
  runtimeRegistry,
} from './runtimeRegistry.js';

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
    ...(handle.metadata ?? {}),
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
 * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
 * @requirement REQ-D01-002
 * @requirement REQ-D01-003
 * @pseudocode lines 122-133
 */
export function registerCliProviderInfrastructure(
  manager: ProviderManager,
  oauthManager: OAuthManager,
  _options: {
    messageBus: MessageBus;
  },
): void {
  const { runtimeId, metadata } = resolveActiveRuntimeIdentity();
  const entry = upsertRuntimeEntry(runtimeId, {
    providerManager: manager,
    oauthManager,
    metadata,
  });
  registerProviderManagerSingleton(manager, oauthManager);

  const config = entry.config ?? null;
  if (config != null) {
    config.setProviderManager(manager);
    manager.setConfig(config);

    logger.debug(
      () =>
        `[cli-runtime] ProviderManager#setConfig applied (loggingEnabled=${config.getConversationLoggingEnabled?.() ?? false})`,
    );
    upsertRuntimeEntry(runtimeId, { config });
  }
}

export function resetCliProviderInfrastructure(runtimeId?: string): void {
  let targetRuntimeId = runtimeId;
  if (!targetRuntimeId) {
    try {
      targetRuntimeId = resolveActiveRuntimeIdentity().runtimeId;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'MissingProviderRuntimeError' ||
          /No active provider runtime context/i.test(error.message) ||
          /MissingProviderRuntimeError/.test(error.message))
      ) {
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
 * Register or update the active CLI runtime context.
 */
export function setCliRuntimeContext(
  settingsService: SettingsService,
  config?: Config,
  options: {
    metadata?: Record<string, unknown>;
    runtimeId?: string;
    profileManager?: ProfileManager;
  } = {},
): void {
  const runtimeId =
    options.runtimeId ?? `cli-runtime-${process.pid.toString(16)}`;
  const metadata = { source: 'cli-runtime', ...(options.metadata ?? {}) };
  const nextContext = createProviderRuntimeContext({
    settingsService,
    config,
    runtimeId,
    metadata,
  });
  logger.debug(() => {
    const providerLabel =
      config != null && typeof config.getProvider === 'function'
        ? ` (provider=${config.getProvider() ?? 'unset'})`
        : '';
    return `[cli-runtime] Registering runtime context ${runtimeId}${providerLabel}`;
  });
  setActiveProviderRuntimeContext(nextContext);

  upsertRuntimeEntry(runtimeId, {
    settingsService,
    config: config ?? null,
    metadata,
    profileManager: options.profileManager,
  });
}
