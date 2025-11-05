/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Authentication precedence utility for providers
 *
 * Implements the authentication precedence chain:
 * 1. /key command key
 * 2. /keyfile command keyfile
 * 3. --key CLI argument
 * 4. --keyfile CLI argument
 * 5. Environment variables
 * 6. OAuth (if enabled)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { SettingsService } from '../settings/SettingsService.js';
import {
  getActiveProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';

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

import { OAuthToken } from './types.js';

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
}

interface ResolveAuthOptions {
  settingsService?: SettingsService | null;
  includeOAuth?: boolean;
}

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P18
 * @requirement REQ-SP2-004
 * @pseudocode auth-runtime-scope.md lines 1-6
 * Runtime-scoped credential bookkeeping keyed by runtime, provider, and profile identifiers.
 */
interface RuntimeScopedAuthEntry {
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

interface RuntimeScopedState {
  runtimeAuthScopeId: string;
  entries: Map<string, RuntimeScopedAuthEntry>;
  metadata: RuntimeAuthScopeMetadataRecord;
  settingsService?: SettingsService;
  settingsSubscriptions: Array<() => void>;
}

const runtimeScopedStates = new Map<string, RuntimeScopedState>();
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
  if (!expiry || Number.isNaN(expiry)) {
    return undefined;
  }
  return expiry > 1_000_000_000_000 ? expiry : expiry * 1000;
}

function resolveProfileId(settingsService: SettingsService): string {
  // Prefer explicit profile tracking, fall back to stored value or default.
  const maybeGetName = (
    settingsService as {
      getCurrentProfileName?: () => string | null;
    }
  ).getCurrentProfileName;
  if (typeof maybeGetName === 'function') {
    const profileName = maybeGetName.call(settingsService);
    if (profileName && profileName.trim()) {
      return profileName.trim();
    }
  }
  const currentProfile = settingsService.get('currentProfile');
  if (typeof currentProfile === 'string' && currentProfile.trim()) {
    return currentProfile.trim();
  }
  return 'default';
}

function buildCacheKey(
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

function ensureRuntimeState(
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

  if (!context.metadata) {
    context.metadata = {};
  }
  context.metadata.runtimeAuthScope = state.metadata;

  if (
    runtimeId === 'legacy-singleton' &&
    !legacyRuntimeScopeWarningEmitted &&
    process.env.DEBUG
  ) {
    console.warn(
      'AuthPrecedenceResolver invoked without runtimeId; using legacy singleton auth cache.',
    );
    legacyRuntimeScopeWarningEmitted = true;
  }

  return state;
}

function recordCacheHit(state: RuntimeScopedState): void {
  state.metadata.metrics.hits += 1;
  state.metadata.metrics.lastUpdated = Date.now();
}

function recordCacheMiss(state: RuntimeScopedState): void {
  state.metadata.metrics.misses += 1;
  state.metadata.metrics.lastUpdated = Date.now();
}

function getValidCachedEntry(
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
  if (entry.stale) {
    return null;
  }
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    invalidateEntry(state, cacheKey, 'expired');
    return null;
  }
  entry.updatedAt = Date.now();
  updateMetadataEntry(state, entry);
  return entry;
}

function registerSettingsSubscriptions(
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
        console.debug(
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

function invalidateMatchingEntries(
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

function storeRuntimeScopedToken(
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

function invalidateEntry(
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
        console.debug(
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

/**
 * Check if authOnly mode is enabled (OAuth-only authentication)
 * @param value The authOnly setting value from SettingsService
 * @returns true if authOnly is enabled, false otherwise
 */
function isAuthOnlyEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return false;
}

export class AuthPrecedenceResolver {
  private config: AuthPrecedenceConfig;
  private oauthManager?: OAuthManager;
  private settingsService?: SettingsService;

  constructor(
    config: AuthPrecedenceConfig,
    oauthManager?: OAuthManager,
    settingsService?: SettingsService,
  ) {
    this.config = config;
    this.oauthManager = oauthManager;
    this.settingsService = settingsService;
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 1-2
   */
  setSettingsService(
    settingsService: SettingsService | null | undefined,
  ): void {
    if (!settingsService) {
      this.settingsService = undefined;
      return;
    }
    this.settingsService = settingsService;
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 1-2
   */
  private resolveSettingsService(
    override?: SettingsService | null,
  ): SettingsService {
    if (override) {
      return override;
    }
    if (this.settingsService) {
      return this.settingsService;
    }
    const context = getActiveProviderRuntimeContext();
    if (!context?.settingsService) {
      throw new Error('Active provider runtime context not available');
    }
    this.settingsService = context.settingsService;
    return this.settingsService;
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 1-3
   * Resolves authentication using the full precedence chain
   * Returns the first available authentication method or null if none found
   */
  async resolveAuthentication(
    options?: ResolveAuthOptions,
  ): Promise<string | null> {
    const includeOAuth = options?.includeOAuth ?? false;
    const settingsService = this.resolveSettingsService(
      options?.settingsService ?? undefined,
    );

    const authOnly = isAuthOnlyEnabled(settingsService.get('authOnly'));

    if (!authOnly) {
      const authKey = settingsService.get('auth-key');
      if (authKey && typeof authKey === 'string' && authKey.trim() !== '') {
        return authKey;
      }

      const authKeyfile = settingsService.get('auth-keyfile');
      if (authKeyfile && typeof authKeyfile === 'string') {
        try {
          const keyFromFile = await this.readKeyFile(authKeyfile);
          if (keyFromFile) {
            return keyFromFile;
          }
        } catch (error) {
          if (process.env.DEBUG) {
            console.warn(
              `Failed to read keyfile from SettingsService ${authKeyfile}:`,
              error,
            );
          }
        }
      }

      if (
        this.config.apiKey &&
        typeof this.config.apiKey === 'string' &&
        this.config.apiKey.trim() !== ''
      ) {
        return this.config.apiKey;
      }

      if (this.config.envKeyNames && this.config.envKeyNames.length > 0) {
        for (const envVarName of this.config.envKeyNames) {
          const envValue = process.env[envVarName];
          if (envValue && envValue.trim() !== '') {
            return envValue;
          }
        }
      }
    }

    if (
      includeOAuth &&
      this.config.isOAuthEnabled &&
      this.config.supportsOAuth &&
      this.oauthManager &&
      this.config.oauthProvider
    ) {
      const providerId =
        this.config.providerId ??
        this.config.oauthProvider ??
        this.config.envKeyNames?.[0] ??
        'unknown-provider';
      const profileId = resolveProfileId(settingsService);

      let runtimeContext: ProviderRuntimeContext | null = null;
      let runtimeState: RuntimeScopedState | null = null;

      try {
        runtimeContext = getActiveProviderRuntimeContext();
        runtimeState = ensureRuntimeState(runtimeContext);
        registerSettingsSubscriptions(
          runtimeState,
          settingsService,
          providerId,
        );
      } catch {
        runtimeContext = null;
        runtimeState = null;
      }

      const managerWithCheck = this.oauthManager as OAuthManager & {
        isOAuthEnabled?(
          provider: string,
        ): boolean | Promise<boolean | undefined>;
      };
      if (
        managerWithCheck.isOAuthEnabled &&
        typeof managerWithCheck.isOAuthEnabled === 'function'
      ) {
        let isEnabledByManager: boolean | undefined;
        try {
          const enabledResult = managerWithCheck.isOAuthEnabled(
            this.config.oauthProvider,
          );
          isEnabledByManager =
            typeof enabledResult === 'boolean'
              ? enabledResult
              : await enabledResult;
        } catch (error) {
          if (process.env.DEBUG) {
            console.debug(
              `Failed to determine OAuth enablement for ${this.config.oauthProvider}:`,
              error,
            );
          }
          isEnabledByManager = undefined;
        }

        if (isEnabledByManager === false) {
          if (runtimeState) {
            const cacheKey = buildCacheKey(
              runtimeState.runtimeAuthScopeId,
              providerId,
              profileId,
            );
            if (runtimeState.entries.has(cacheKey)) {
              invalidateEntry(runtimeState, cacheKey, 'oauth-disabled');
            }
          }
          return null;
        }
      }

      if (runtimeState) {
        const cachedEntry = getValidCachedEntry(
          runtimeState,
          providerId,
          profileId,
        );
        if (cachedEntry) {
          recordCacheHit(runtimeState);
          return cachedEntry.token;
        }

        recordCacheMiss(runtimeState);
      }

      try {
        const requestMetadata: OAuthTokenRequestMetadata = {
          runtimeAuthScopeId: runtimeState?.runtimeAuthScopeId ?? 'no-runtime',
          providerId,
          profileId,
          cliScope:
            runtimeContext?.metadata &&
            typeof runtimeContext.metadata === 'object'
              ? runtimeContext.metadata
              : undefined,
          runtimeMetadata:
            runtimeContext?.metadata &&
            typeof runtimeContext.metadata === 'object'
              ? runtimeContext.metadata
              : undefined,
        };

        const token = await this.oauthManager.getToken(
          this.config.oauthProvider,
          requestMetadata,
        );
        if (token) {
          let oauthToken: OAuthToken | null | undefined;
          if (typeof this.oauthManager.getOAuthToken === 'function') {
            try {
              oauthToken = await this.oauthManager.getOAuthToken(
                this.config.oauthProvider,
                requestMetadata,
              );
            } catch (tokenError) {
              if (process.env.DEBUG) {
                console.debug(
                  `Failed to fetch OAuth token metadata for ${this.config.oauthProvider}:`,
                  tokenError,
                );
              }
              oauthToken = null;
            }
          }
          if (runtimeState) {
            storeRuntimeScopedToken(
              runtimeState,
              providerId,
              profileId,
              token,
              oauthToken ?? null,
            );
          }
          return token;
        }
      } catch (error) {
        if (process.env.DEBUG) {
          console.warn(
            `Failed to get OAuth token for ${this.config.oauthProvider}:`,
            error,
          );
        }
      }
    }

    return null;
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 1-3
   * Check if any authentication method is available without triggering OAuth
   */
  async hasNonOAuthAuthentication(
    options?: ResolveAuthOptions,
  ): Promise<boolean> {
    const auth = await this.resolveAuthentication({
      ...options,
      includeOAuth: false,
    });
    return auth !== null;
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 1-3
   * Check if OAuth is the only available authentication method
   */
  async isOAuthOnlyAvailable(options?: ResolveAuthOptions): Promise<boolean> {
    const hasNonOAuth = await this.hasNonOAuthAuthentication(options);
    return (
      !hasNonOAuth &&
      this.config.isOAuthEnabled === true &&
      this.config.supportsOAuth === true
    );
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 1-3
   * Get authentication method name for debugging/logging
   */
  async getAuthMethodName(
    options?: ResolveAuthOptions,
  ): Promise<string | null> {
    const settingsService = this.resolveSettingsService(
      options?.settingsService ?? undefined,
    );

    // Check precedence levels and return method name
    const authKey = settingsService.get('auth-key');
    if (authKey && typeof authKey === 'string' && authKey.trim() !== '') {
      return 'command-key';
    }

    const authKeyfile = settingsService.get('auth-keyfile');
    if (authKeyfile && typeof authKeyfile === 'string') {
      try {
        const keyFromFile = await this.readKeyFile(authKeyfile);
        if (keyFromFile) {
          return 'command-keyfile';
        }
      } catch {
        // Ignore errors for method detection
      }
    }

    if (
      this.config.apiKey &&
      typeof this.config.apiKey === 'string' &&
      this.config.apiKey.trim() !== ''
    ) {
      return 'constructor-apikey';
    }

    if (this.config.envKeyNames && this.config.envKeyNames.length > 0) {
      for (const envVarName of this.config.envKeyNames) {
        const envValue = process.env[envVarName];
        if (envValue && envValue.trim() !== '') {
          return `env-${envVarName.toLowerCase()}`;
        }
      }
    }

    if (
      this.config.isOAuthEnabled &&
      this.config.supportsOAuth &&
      this.oauthManager &&
      this.config.oauthProvider
    ) {
      try {
        const isAuthenticated = await this.oauthManager.isAuthenticated(
          this.config.oauthProvider,
        );
        if (isAuthenticated) {
          return `oauth-${this.config.oauthProvider}`;
        }
      } catch {
        // Ignore errors for method detection
      }
    }

    return null;
  }

  /**
   * Reads API key from a file path, handling tilde expansion, absolute and relative paths
   */
  private async readKeyFile(filePath: string): Promise<string | null> {
    try {
      // Handle tilde expansion for home directory
      const expandedPath = filePath.startsWith('~')
        ? path.join(os.homedir(), filePath.slice(1))
        : filePath;

      // Handle relative paths from current working directory
      const resolvedPath = path.isAbsolute(expandedPath)
        ? expandedPath
        : path.resolve(process.cwd(), expandedPath);

      const content = await fs.readFile(resolvedPath, 'utf-8');
      const key = content.trim();

      if (key === '') {
        if (process.env.DEBUG) {
          console.warn(`Key file ${filePath} is empty`);
        }
        return null;
      }

      return key;
    } catch (error) {
      if (process.env.DEBUG) {
        console.warn(`Failed to read key file ${filePath}:`, error);
      }
      return null;
    }
  }

  /**
   * Updates the configuration
   */
  updateConfig(newConfig: Partial<AuthPrecedenceConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Updates the OAuth manager
   */
  updateOAuthManager(oauthManager: OAuthManager): void {
    this.oauthManager = oauthManager;
  }
}
