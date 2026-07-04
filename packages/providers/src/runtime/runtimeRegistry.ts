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
 * @plan PLAN-20260630-ISSUE2300
 * Runtime registry that scopes Config/SettingsService/RuntimeProviderManager instances per runtimeId.
 *
 * Identity resolution is now explicit and deterministic (issue #2300):
 * - A registered AsyncLocalStorage runtime scope wins.
 * - Otherwise an explicit default CLI runtime id, if set and registered.
 * - Otherwise resolution fails with a clear error.
 *
 * No legacy-singleton phantom fallback and no first-registered guessing.
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
import {
  registerProviderManagerSingleton,
  resetProviderManager,
} from '../composition/index.js';
import {
  getCurrentRuntimeScope,
  type RuntimeScopeValue,
} from './runtimeContextFactory.js';
import {
  formatMissingRuntimeMessage,
  MissingProviderRuntimeError,
} from './messages.js';
import { validateRuntimeId } from './runtimeIdValidation.js';

/**
 * Diagnostic classification of a runtime's provenance. Recorded on each
 * registry entry and surfaced in debug logs and error metadata so failures
 * are traceable to the runtime that produced them. It intentionally carries
 * no authorization semantics: every runtime kind is a first-class participant
 * in identity resolution and OAuth infrastructure.
 */
export type RuntimeKind =
  | 'cli-bootstrap'
  | 'cli-interactive'
  | 'agent'
  | 'subagent';

type RuntimeIdentity = RuntimeScopeValue;

const logger = new DebugLogger('llxprt:runtime:settings');

export interface RuntimeRegistryEntry {
  runtimeId: string;
  runtimeKind: RuntimeKind;
  settingsService: SettingsService | null;
  config: Config | null;
  providerManager: RuntimeProviderManager | null;
  oauthManager: OAuthManager | null;
  profileManager: ProfileManager | null;
  metadata: Record<string, unknown>;
}

interface RuntimeRegistryEntryWithInfrastructure extends RuntimeRegistryEntry {
  providerManager: RuntimeProviderManager;
  oauthManager: OAuthManager;
}

function hasProviderInfrastructure(
  entry: RuntimeRegistryEntry | undefined,
): entry is RuntimeRegistryEntryWithInfrastructure {
  if (!entry) {
    return false;
  }
  return Boolean(entry.providerManager && entry.oauthManager);
}

function hasPartialProviderInfrastructure(
  entry: RuntimeRegistryEntry | undefined,
): boolean {
  if (!entry || hasProviderInfrastructure(entry)) {
    return false;
  }
  return Boolean(entry.providerManager ?? entry.oauthManager);
}

export const runtimeRegistry = new Map<string, RuntimeRegistryEntry>();

/**
 * The explicit default CLI runtime id: the process-wide foreground runtime used
 * to resolve identity when no AsyncLocalStorage scope is active. Set by the CLI
 * composition boundary (setCliRuntimeContext). Resolution still requires the
 * default to be registered.
 */
let defaultCliRuntimeId: string | undefined;

/**
 * @plan PLAN-20260630-ISSUE2300
 * Establish the process-wide default (foreground) CLI runtime id.
 *
 * The default pointer is write-once with respect to a given foreground runtime:
 * re-affirming the SAME id is an idempotent no-op, but binding a DIFFERENT id
 * over an existing default throws — a background/isolated runtime can never
 * silently become the foreground default (issue #2300). A deliberate foreground
 * hand-off (e.g. the Zed integration replacing the bootstrap runtime) must opt
 * in explicitly via `allowReplace`.
 */
export function setDefaultCliRuntimeId(
  runtimeId: string,
  options: { allowReplace?: boolean } = {},
): void {
  validateRuntimeId(runtimeId);
  if (defaultCliRuntimeId === runtimeId) {
    return;
  }
  if (defaultCliRuntimeId !== undefined && options.allowReplace !== true) {
    throw new Error(
      `[cli-runtime] Refusing to overwrite the default CLI runtime pointer ` +
        `'${defaultCliRuntimeId}' with '${runtimeId}'. The foreground CLI ` +
        `runtime is set once at bootstrap; only an explicit hand-off may ` +
        `replace it. This guards against a background or isolated runtime ` +
        `implicitly becoming the default (issue #2300).`,
    );
  }
  defaultCliRuntimeId = runtimeId;
}

export function getDefaultCliRuntimeId(): string | undefined {
  return defaultCliRuntimeId;
}

/**
 * Clear the default CLI runtime pointer only when the given runtimeId matches
 * the current default, preventing a racing runtime from clearing another's
 * default pointer.
 */
export function clearDefaultCliRuntimeId(runtimeId: string): void {
  if (runtimeId === defaultCliRuntimeId) {
    defaultCliRuntimeId = undefined;
  }
}

export function resetDefaultCliRuntimeIdForTesting(): void {
  defaultCliRuntimeId = undefined;
}

export function resolveActiveRuntimeIdentity(): RuntimeIdentity {
  const alsScope = getCurrentRuntimeScope();
  if (alsScope) {
    // An active ALS scope is an explicit, deliberate claim of identity. If its
    // runtime is registered, it wins. If it is NOT registered, the scope is
    // stale or leaked — we fail hard rather than silently routing to the CLI
    // default, which would let a torn-down isolated runtime borrow foreground
    // credentials (issue #2300).
    const entry = runtimeRegistry.get(alsScope.runtimeId);
    if (entry) {
      return alsScope;
    }
    throw new MissingProviderRuntimeError({
      providerKey: 'provider-runtime',
      missingFields: ['active runtime'],
      message:
        `Active runtime scope '${alsScope.runtimeId}' is not registered. ` +
        `A stale or torn-down AsyncLocalStorage scope must not fall back to ` +
        `the default CLI runtime (issue #2300). ` +
        formatMissingRuntimeMessage({
          runtimeId: alsScope.runtimeId,
          missingFields: ['active runtime'],
          hint: 'Register the scoped runtime before use, or exit the scope so the default CLI runtime resolves.',
        }),
    });
  }

  const defaultId = defaultCliRuntimeId;
  if (defaultId) {
    const entry = runtimeRegistry.get(defaultId);
    if (entry) {
      return {
        runtimeId: defaultId,
        metadata: entry.metadata,
      };
    }
    logger.debug(
      () =>
        `[resolveActiveRuntimeIdentity] default CLI runtimeId=${defaultId} is set but not registered; cannot resolve identity.`,
    );
  }

  throw new MissingProviderRuntimeError({
    providerKey: 'provider-runtime',
    missingFields: ['active runtime'],
    message:
      `No active runtime. Ensure enterRuntimeScope() or setCliRuntimeContext() was called before consuming CLI runtime helpers. ` +
      formatMissingRuntimeMessage({
        runtimeId: defaultId ?? 'unknown',
        missingFields: ['active runtime'],
        hint: 'Identity is resolved from a registered AsyncLocalStorage scope or an explicit default CLI runtime id set via setCliRuntimeContext().',
      }),
  });
}

export function upsertRuntimeEntry(
  runtimeId: string,
  update: Partial<Omit<RuntimeRegistryEntry, 'runtimeId'>>,
): RuntimeRegistryEntry {
  const current = runtimeRegistry.get(runtimeId);
  const next: RuntimeRegistryEntry = {
    runtimeId,
    runtimeKind:
      update.runtimeKind ?? current?.runtimeKind ?? 'cli-interactive',
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

  throw new MissingProviderRuntimeError({
    providerKey: 'provider-runtime',
    missingFields: ['runtime registration'],
    message: formatMissingRuntimeMessage({
      runtimeId,
      missingFields: ['runtime registration'],
      hint,
    }),
  });
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

  const removedEntry = runtimeRegistry.get(runtimeId);
  runtimeRegistry.delete(runtimeId);

  const activeContext = peekActiveProviderRuntimeContext();
  if (activeContext?.runtimeId === runtimeId) {
    clearSettingsProviderRuntimeContext();
  }

  const defaultEntry = defaultCliRuntimeId
    ? runtimeRegistry.get(defaultCliRuntimeId)
    : undefined;

  clearDefaultCliRuntimeId(runtimeId);
  const replacementEntry = hasProviderInfrastructure(defaultEntry)
    ? defaultEntry
    : undefined;
  if (defaultEntry && hasPartialProviderInfrastructure(defaultEntry)) {
    logger.debug(
      () =>
        `[disposeCliRuntime] Default runtime ${defaultEntry.runtimeId} has partial provider infrastructure; provider singleton will be reset if the disposed runtime owned it.`,
    );
  }

  if (replacementEntry) {
    registerProviderManagerSingleton(
      replacementEntry.providerManager as never,
      replacementEntry.oauthManager,
    );
  } else if (removedEntry?.providerManager || removedEntry?.oauthManager) {
    resetProviderManager();
  }
}

export function resetCliRuntimeRegistryForTesting(): void {
  runtimeRegistry.clear();
  resetDefaultCliRuntimeIdForTesting();
  clearSettingsProviderRuntimeContext();
  resetProviderManager();
}
