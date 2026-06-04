/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Authentication precedence utility for providers
 *
 * Implements the authentication precedence chain:
 * 1. Provider-specific auth-key/keyfile (from getProviderSettings)
 * 2. Constructor API key
 * 3. Global auth-key/keyfile (from settings when activeProvider matches)
 * 4. Environment variables
 * 5. OAuth (if enabled)
 */

import type { SettingsService } from '../settings/SettingsService.js';
import type { ProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';

export interface AuthPrecedenceConfig {
  // Constructor/direct API key
  apiKey?: string;

  // Environment variable names to check
  envKeyNames?: string[];

  // OAuth configuration
  isOAuthEnabled?: boolean;
  supportsOAuth?: boolean;
  oauthProvider?: string;
  providerId?: string;
}

import { type OAuthToken } from './types.js';
import { debugLogger } from '../utils/debugLogger.js';

export interface OAuthTokenRequestMetadata {
  runtimeAuthScopeId?: string;
  providerId?: string;
  profileId?: string;
  cliScope?: Record<string, unknown>;
  runtimeMetadata?: Record<string, unknown>;
}

export interface OAuthManager {
  getToken(
    provider: string,
    metadata?: OAuthTokenRequestMetadata,
  ): Promise<string | null>;
  isAuthenticated(provider: string): Promise<boolean>;
  getOAuthToken?(
    provider: string,
    metadata?: OAuthTokenRequestMetadata,
  ): Promise<OAuthToken | null>;
  /**
   * Force refresh a token when it is known to be revoked.
   * @param provider - The provider name
   * @param failedAccessToken - The access token that was rejected
   * @returns The refreshed token, or null if refresh was not possible
   * @fix issue1861 - Token revocation handling
   */
  forceRefreshToken?(
    provider: string,
    failedAccessToken: string,
  ): Promise<OAuthToken | null>;
}

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P18
 * @requirement REQ-SP2-004
 * @pseudocode auth-runtime-scope.md lines 1-6
 * Runtime-scoped credential bookkeeping keyed by runtime, provider, and profile identifiers.
 */
export interface RuntimeScopedAuthEntry {
  key: string;
  providerId: string;
  profileId: string;
  runtimeAuthScopeId: string;
  token: string;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  stale: boolean;
  cancellationHook?: () => void | Promise<void>;
}

export interface RuntimeAuthScopeCacheEntrySummary {
  key: string;
  providerId: string;
  profileId: string;
  runtimeAuthScopeId: string;
  preview: string;
  createdAt: number;
  expiresAt?: number;
  stale: boolean;
  reason?: string;
}

interface RuntimeAuthScopeMetadataRecord {
  runtimeAuthScopeId: string;
  cacheEntries: RuntimeAuthScopeCacheEntrySummary[];
  cancellationHooks: Array<() => void | Promise<void>>;
  revokedTokens: RuntimeAuthScopeCacheEntrySummary[];
  metrics: {
    hits: number;
    misses: number;
    lastUpdated: number;
  };
}

export interface RuntimeScopedState {
  runtimeAuthScopeId: string;
  entries: Map<string, RuntimeScopedAuthEntry>;
  metadata: RuntimeAuthScopeMetadataRecord;
  settingsService?: SettingsService;
  settingsSubscriptions: Array<() => void>;
}

export const runtimeScopedStates = new Map<string, RuntimeScopedState>();
let legacyRuntimeScopeWarningEmitted = false;

function maskToken(token: string): string {
  if (!token) {
    return '[redacted]';
  }
  const trimmed = token.replace(/\s+/g, '');
  if (trimmed.length <= 4) {
    return '*'.repeat(trimmed.length);
  }
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

function normalizeExpiry(expiry?: number | null): number | undefined {
  if (expiry == null || expiry === 0 || Number.isNaN(expiry)) {
    return undefined;
  }
  return expiry > 1_000_000_000_000 ? expiry : expiry * 1000;
}

export function resolveProfileId(
  settingsService: SettingsService,
): string | null {
  // Prefer explicit profile tracking, fall back to stored value.
  // IMPORTANT: Returning null means "no profile loaded" and callers must avoid
  // passing a synthetic "default" profileId into OAuth metadata.
  const maybeGetName = (
    settingsService as {
      getCurrentProfileName?: () => string | null;
    }
  ).getCurrentProfileName;
  if (typeof maybeGetName === 'function') {
    const profileName = maybeGetName.call(settingsService);
    if (profileName?.trim()) {
      return profileName.trim();
    }
  }
  const currentProfile = settingsService.get('currentProfile');
  if (typeof currentProfile === 'string' && currentProfile.trim()) {
    return currentProfile.trim();
  }
  return null;
}

export function buildCacheKey(
  runtimeId: string,
  providerId: string,
  profileId: string,
): string {
  return `${runtimeId}::${providerId}::${profileId}`;
}

function toPublicEntry(
  entry: RuntimeScopedAuthEntry,
  overrides?: Partial<RuntimeAuthScopeCacheEntrySummary>,
): RuntimeAuthScopeCacheEntrySummary {
  const summary: RuntimeAuthScopeCacheEntrySummary = {
    key: entry.key,
    providerId: entry.providerId,
    profileId: entry.profileId,
    runtimeAuthScopeId: entry.runtimeAuthScopeId,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    preview: maskToken(entry.token),
    stale: entry.stale,
  };
  return overrides ? { ...summary, ...overrides } : summary;
}

function updateMetadataEntry(
  state: RuntimeScopedState,
  entry: RuntimeScopedAuthEntry,
  summary?: RuntimeAuthScopeCacheEntrySummary,
): void {
  const snapshot = summary ?? toPublicEntry(entry);
  const existingIndex = state.metadata.cacheEntries.findIndex(
    (item) => item.key === snapshot.key,
  );
  if (existingIndex >= 0) {
    state.metadata.cacheEntries[existingIndex] = snapshot;
  } else {
    state.metadata.cacheEntries.push(snapshot);
  }
  state.metadata.metrics.lastUpdated = Date.now();
}

export function ensureRuntimeState(
  context: ProviderRuntimeContext,
): RuntimeScopedState {
  const runtimeId = context.runtimeId ?? 'legacy-singleton';
  let state = runtimeScopedStates.get(runtimeId);
  if (!state) {
    const metadata: RuntimeAuthScopeMetadataRecord = {
      runtimeAuthScopeId: runtimeId,
      cacheEntries: [],
      cancellationHooks: [],
      revokedTokens: [],
      metrics: {
        hits: 0,
        misses: 0,
        lastUpdated: Date.now(),
      },
    };
    state = {
      runtimeAuthScopeId: runtimeId,
      entries: new Map(),
      metadata,
      settingsSubscriptions: [],
    };
    runtimeScopedStates.set(runtimeId, state);
  }

  context.metadata ??= {};
  context.metadata.runtimeAuthScope = state.metadata;

  if (
    runtimeId === 'legacy-singleton' &&
    !legacyRuntimeScopeWarningEmitted &&
    process.env.DEBUG
  ) {
    debugLogger.warn(
      'AuthPrecedenceResolver invoked without runtimeId; using legacy singleton auth cache.',
    );
    legacyRuntimeScopeWarningEmitted = true;
  }

  return state;
}

export function recordCacheHit(state: RuntimeScopedState): void {
  state.metadata.metrics.hits += 1;
  state.metadata.metrics.lastUpdated = Date.now();
}

export function recordCacheMiss(state: RuntimeScopedState): void {
  state.metadata.metrics.misses += 1;
  state.metadata.metrics.lastUpdated = Date.now();
}

export function getValidCachedEntry(
  state: RuntimeScopedState,
  providerId: string,
  profileId: string,
): RuntimeScopedAuthEntry | null {
  const cacheKey = buildCacheKey(
    state.runtimeAuthScopeId,
    providerId,
    profileId,
  );
  const entry = state.entries.get(cacheKey);
  if (!entry) {
    return null;
  }
  if (entry.stale === true) {
    return null;
  }
  if (entry.expiresAt != null && entry.expiresAt <= Date.now()) {
    invalidateEntry(state, cacheKey, 'expired');
    return null;
  }
  entry.updatedAt = Date.now();
  updateMetadataEntry(state, entry);
  return entry;
}

export function registerSettingsSubscriptions(
  state: RuntimeScopedState,
  settingsService: SettingsService,
  providerId: string,
): void {
  if (state.settingsService === settingsService) {
    return;
  }
  for (const unsubscribe of state.settingsSubscriptions) {
    try {
      unsubscribe();
    } catch (error) {
      if (process.env.DEBUG) {
        debugLogger.debug(
          'Failed to remove runtime auth scope subscription:',
          error,
        );
      }
    }
  }
  state.settingsSubscriptions = [];
  state.settingsService = settingsService;

  const handleProviderChange = (...args: unknown[]): void => {
    const [event] = args;
    const payload = (event ?? {}) as {
      provider?: string;
      key?: string;
    };
    if (payload.provider === providerId) {
      invalidateMatchingEntries(
        state,
        (entry) => entry.providerId === providerId,
        'provider-change',
      );
    }
  };
  settingsService.on('provider-change', handleProviderChange);
  state.settingsSubscriptions.push(() =>
    settingsService.off('provider-change', handleProviderChange),
  );

  const handleProfileChange = (...args: unknown[]): void => {
    const [event] = args;
    const payload = (event ?? {}) as { key?: string };
    if (payload.key === 'currentProfile') {
      invalidateMatchingEntries(state, () => true, 'profile-change');
    }
  };
  settingsService.on('change', handleProfileChange);
  state.settingsSubscriptions.push(() =>
    settingsService.off('change', handleProfileChange),
  );

  const handleCleared = (..._args: unknown[]): void => {
    invalidateMatchingEntries(state, () => true, 'settings-cleared');
  };
  settingsService.on('cleared', handleCleared);
  state.settingsSubscriptions.push(() =>
    settingsService.off('cleared', handleCleared),
  );
}

export function invalidateMatchingEntries(
  state: RuntimeScopedState,
  predicate: (entry: RuntimeScopedAuthEntry) => boolean,
  reason: string,
): RuntimeAuthScopeCacheEntrySummary[] {
  const summaries: RuntimeAuthScopeCacheEntrySummary[] = [];
  for (const entry of [...state.entries.values()]) {
    if (predicate(entry)) {
      summaries.push(invalidateEntry(state, entry.key, reason));
    }
  }
  return summaries;
}

export function storeRuntimeScopedToken(
  state: RuntimeScopedState,
  providerId: string,
  profileId: string,
  token: string,
  oauthToken?: OAuthToken | null,
): void {
  const cacheKey = buildCacheKey(
    state.runtimeAuthScopeId,
    providerId,
    profileId,
  );
  const expiresAt = normalizeExpiry(oauthToken?.expiry ?? null);
  const now = Date.now();

  let entry = state.entries.get(cacheKey);
  if (!entry) {
    entry = {
      key: cacheKey,
      providerId,
      profileId,
      runtimeAuthScopeId: state.runtimeAuthScopeId,
      token,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      stale: false,
    };
    state.entries.set(cacheKey, entry);
  } else {
    entry.token = token;
    entry.updatedAt = now;
    entry.expiresAt = expiresAt;
    entry.stale = false;
  }

  if (entry.cancellationHook) {
    state.metadata.cancellationHooks = state.metadata.cancellationHooks.filter(
      (hook) => hook !== entry.cancellationHook,
    );
  }

  const cancellationHook = (): void => {
    invalidateEntry(state, cacheKey, 'cancellation-hook');
  };
  entry.cancellationHook = cancellationHook;
  state.metadata.cancellationHooks.push(cancellationHook);

  updateMetadataEntry(state, entry, toPublicEntry(entry));
}

export function invalidateEntry(
  state: RuntimeScopedState,
  cacheKey: string,
  reason: string,
): RuntimeAuthScopeCacheEntrySummary {
  const entry = state.entries.get(cacheKey);
  if (!entry) {
    const summary: RuntimeAuthScopeCacheEntrySummary = {
      key: cacheKey,
      providerId: 'unknown',
      profileId: 'default',
      runtimeAuthScopeId: state.runtimeAuthScopeId,
      preview: '[revoked]',
      createdAt: Date.now(),
      expiresAt: undefined,
      stale: true,
      reason,
    };
    state.metadata.revokedTokens.push(summary);
    state.metadata.metrics.lastUpdated = Date.now();
    return summary;
  }

  entry.stale = true;
  entry.updatedAt = Date.now();

  const summary = toPublicEntry(entry, { stale: true, reason });
  state.entries.delete(cacheKey);
  updateMetadataEntry(state, entry, summary);

  if (entry.cancellationHook) {
    state.metadata.cancellationHooks = state.metadata.cancellationHooks.filter(
      (hook) => hook !== entry.cancellationHook,
    );
  }

  state.metadata.revokedTokens.push(summary);
  state.metadata.metrics.lastUpdated = Date.now();

  entry.token = '';
  entry.expiresAt = undefined;
  entry.cancellationHook = undefined;

  return summary;
}

export interface RuntimeAuthScopeFlushResult {
  runtimeId: string;
  revokedTokens: RuntimeAuthScopeCacheEntrySummary[];
}

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P18
 * @requirement REQ-SP2-004
 * @pseudocode auth-runtime-scope.md lines 7-7
 * Flush scoped credentials for a runtime and return revocation metadata.
 */
export function flushRuntimeAuthScope(
  runtimeId: string,
): RuntimeAuthScopeFlushResult {
  const state = runtimeScopedStates.get(runtimeId);
  if (!state) {
    return { runtimeId, revokedTokens: [] };
  }

  const revokedTokens: RuntimeAuthScopeCacheEntrySummary[] = [];
  for (const key of [...state.entries.keys()]) {
    revokedTokens.push(invalidateEntry(state, key, 'runtime-dispose'));
  }

  for (const unsubscribe of state.settingsSubscriptions) {
    try {
      unsubscribe();
    } catch (error) {
      if (process.env.DEBUG) {
        debugLogger.debug(
          'Failed to clean runtime auth scope subscription:',
          error,
        );
      }
    }
  }
  state.settingsSubscriptions = [];
  state.settingsService = undefined;

  state.metadata.cancellationHooks = [];
  state.metadata.cacheEntries = state.metadata.cacheEntries.map((entry) => ({
    ...entry,
    stale: true,
  }));
  state.metadata.metrics.lastUpdated = Date.now();

  runtimeScopedStates.delete(runtimeId);

  return { runtimeId, revokedTokens };
}

export { AuthPrecedenceResolver } from './auth-precedence-resolver.js';
