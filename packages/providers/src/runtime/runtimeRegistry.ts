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
 * @plan PLAN-20251018-STATELESSPROVIDER2.P15
 * @requirement REQ-SP2-003
 * @pseudocode cli-runtime-isolation.md lines 1-3
 * Runtime registry that scopes Config/SettingsService/RuntimeProviderManager instances per runtimeId.
 */

import {
  type Config,
  DebugLogger,
  peekActiveProviderRuntimeContext,
  type RuntimeProviderManager,
  type RuntimeAuthScopeFlushResult,
} from '@vybestack/llxprt-code-core';
import { clearSettingsProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js';
import type {
  SettingsService,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';
import { type OAuthManager } from '../auth/index.js';
import { resetProviderManager } from '../composition/index.js';
import { getCurrentRuntimeScope } from './runtimeContextFactory.js';
import { formatMissingRuntimeMessage } from './messages.js';
import {
  resolveFromActiveContext,
  resolveFromAsyncLocalStorage,
  resolveFromFirstRegistered,
  type RuntimeIdentity,
} from './runtimeIdentityResolution.js';

const logger = new DebugLogger('llxprt:runtime:settings');

export interface RuntimeRegistryEntry {
  runtimeId: string;
  settingsService: SettingsService | null;
  config: Config | null;
  providerManager: RuntimeProviderManager | null;
  oauthManager: OAuthManager | null;
  profileManager: ProfileManager | null;
  metadata: Record<string, unknown>;
}

export const runtimeRegistry = new Map<string, RuntimeRegistryEntry>();
export const LEGACY_RUNTIME_ID = 'legacy-singleton';

export function resolveActiveRuntimeIdentity(): RuntimeIdentity {
  return (
    resolveFromAsyncLocalStorage(getCurrentRuntimeScope()) ??
    resolveFromActiveContext(runtimeRegistry, LEGACY_RUNTIME_ID) ??
    resolveFromFirstRegistered(runtimeRegistry) ?? {
      runtimeId: LEGACY_RUNTIME_ID,
      metadata: {},
    }
  );
}

export function upsertRuntimeEntry(
  runtimeId: string,
  update: Partial<Omit<RuntimeRegistryEntry, 'runtimeId'>>,
): RuntimeRegistryEntry {
  const current = runtimeRegistry.get(runtimeId);
  const next: RuntimeRegistryEntry = {
    runtimeId,
    settingsService: resolveFieldUpdate(
      update,
      'settingsService',
      current?.settingsService,
    ),
    config: resolveFieldUpdate(update, 'config', current?.config),
    providerManager: resolveFieldUpdate(
      update,
      'providerManager',
      current?.providerManager,
    ),
    oauthManager: resolveFieldUpdate(
      update,
      'oauthManager',
      current?.oauthManager,
    ),
    profileManager: resolveFieldUpdate(
      update,
      'profileManager',
      current?.profileManager,
    ),
    metadata:
      update.metadata !== undefined
        ? { ...(current?.metadata ?? {}), ...update.metadata }
        : (current?.metadata ?? {}),
  };
  runtimeRegistry.set(runtimeId, next);
  logger.debug(
    () =>
      `[upsertRuntimeEntry] SET runtimeId=${runtimeId}, hasConfig=${!!next.config}, hasProviderManager=${!!next.providerManager}, registered=[${Array.from(runtimeRegistry.keys()).join(', ')}]`,
  );
  return next;
}

/**
 * Resolve a field update: when the update object explicitly owns the key
 * (own property), prefer its value (falling back to null); otherwise keep
 * the existing value.
 */
function resolveFieldUpdate<T>(
  update: Record<string, unknown>,
  key: string,
  current: T | null | undefined,
): T | null {
  if (Object.prototype.hasOwnProperty.call(update, key)) {
    return (update[key] as T | null | undefined) ?? null;
  }
  return current ?? null;
}

export function requireRuntimeEntry(runtimeId: string): RuntimeRegistryEntry {
  const entry = runtimeRegistry.get(runtimeId);
  if (entry) {
    return entry;
  }

  const registeredIds = Array.from(runtimeRegistry.keys());
  const scope = getCurrentRuntimeScope();
  const activeCtx = peekActiveProviderRuntimeContext();
  logger.debug(
    () =>
      `[requireRuntimeEntry] MISS for runtimeId=${runtimeId}; registered=[${registeredIds.join(', ')}]; scope=${JSON.stringify(scope)}; activeCtx.runtimeId=${activeCtx?.runtimeId}`,
  );

  const hint =
    'Ensure setCliRuntimeContext() was called before consuming CLI helpers.';

  throw new Error(
    formatMissingRuntimeMessage({
      runtimeId,
      missingFields: ['runtime registration'],
      hint,
    }),
  );
}

export function disposeCliRuntime(
  runtimeId: string,
  context?: RuntimeAuthScopeFlushResult,
): void {
  if (context !== undefined && context.revokedTokens.length > 0) {
    logger.debug(
      () =>
        `[cli-runtime] Revoked ${context.revokedTokens.length} scoped OAuth token(s) for runtime ${runtimeId}.`,
    );
  }

  runtimeRegistry.delete(runtimeId);

  const activeContext = peekActiveProviderRuntimeContext();
  if (activeContext?.runtimeId === runtimeId) {
    clearSettingsProviderRuntimeContext();
  }

  resetProviderManager();
}

export function resetCliRuntimeRegistryForTesting(): void {
  runtimeRegistry.clear();
  clearSettingsProviderRuntimeContext();
  resetProviderManager();
}
