/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P15
 * @requirement REQ-SP2-003
 * @pseudocode cli-runtime-isolation.md lines 1-3
 * Runtime registry that scopes Config/SettingsService/ProviderManager instances per runtimeId.
 */

import {
  type Config,
  DebugLogger,
  type SettingsService,
  type ProfileManager,
  clearActiveProviderRuntimeContext,
  peekActiveProviderRuntimeContext,
  type ProviderManager,
  type RuntimeAuthScopeFlushResult,
} from '@vybestack/llxprt-code-core';
import { type OAuthManager } from '../auth/oauth-manager.js';
import { resetProviderManager } from '../providers/providerManagerInstance.js';
import { getCurrentRuntimeScope } from './runtimeContextFactory.js';
import { formatMissingRuntimeMessage } from './messages.js';

const logger = new DebugLogger('llxprt:runtime:settings');

export interface RuntimeRegistryEntry {
  runtimeId: string;
  settingsService: SettingsService | null;
  config: Config | null;
  providerManager: ProviderManager | null;
  oauthManager: OAuthManager | null;
  profileManager: ProfileManager | null;
  metadata: Record<string, unknown>;
}

export const runtimeRegistry = new Map<string, RuntimeRegistryEntry>();
export const LEGACY_RUNTIME_ID = 'legacy-singleton';

export function resolveActiveRuntimeIdentity(): {
  runtimeId: string;
  metadata: Record<string, unknown>;
} {
  const scope = getCurrentRuntimeScope();
  if (scope) {
    return scope;
  }

  const context = peekActiveProviderRuntimeContext();
  if (context) {
    const candidateId =
      typeof context.runtimeId === 'string' && context.runtimeId.trim() !== ''
        ? context.runtimeId
        : LEGACY_RUNTIME_ID;

    // If the active context's runtimeId is registered in the CLI registry, use it.
    // Otherwise fall back to a registered ID — the active context may be a
    // provider-scoped context (e.g. a per-call UUID from BaseProvider) that was
    // never registered in the CLI runtime registry.
    if (runtimeRegistry.has(candidateId)) {
      return { runtimeId: candidateId, metadata: context.metadata ?? {} };
    }

    // Fall back to the first registered runtimeId (typically cli.runtime.bootstrap)
    const firstRegistered = runtimeRegistry.keys().next().value;
    if (firstRegistered) {
      return { runtimeId: firstRegistered, metadata: context.metadata ?? {} };
    }

    return { runtimeId: candidateId, metadata: context.metadata ?? {} };
  }

  return { runtimeId: LEGACY_RUNTIME_ID, metadata: {} };
}

export function upsertRuntimeEntry(
  runtimeId: string,
  update: Partial<Omit<RuntimeRegistryEntry, 'runtimeId'>>,
): RuntimeRegistryEntry {
  const current = runtimeRegistry.get(runtimeId);
  const next: RuntimeRegistryEntry = {
    runtimeId,
    settingsService: Object.prototype.hasOwnProperty.call(
      update,
      'settingsService',
    )
      ? (update.settingsService ?? null)
      : (current?.settingsService ?? null),
    config: Object.prototype.hasOwnProperty.call(update, 'config')
      ? (update.config ?? null)
      : (current?.config ?? null),
    providerManager: Object.prototype.hasOwnProperty.call(
      update,
      'providerManager',
    )
      ? (update.providerManager ?? null)
      : (current?.providerManager ?? null),
    oauthManager: Object.prototype.hasOwnProperty.call(update, 'oauthManager')
      ? (update.oauthManager ?? null)
      : (current?.oauthManager ?? null),
    profileManager: Object.prototype.hasOwnProperty.call(
      update,
      'profileManager',
    )
      ? (update.profileManager ?? null)
      : (current?.profileManager ?? null),
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
    clearActiveProviderRuntimeContext();
  }

  resetProviderManager();
}

export function resetCliRuntimeRegistryForTesting(): void {
  runtimeRegistry.clear();
  clearActiveProviderRuntimeContext();
  resetProviderManager();
}
