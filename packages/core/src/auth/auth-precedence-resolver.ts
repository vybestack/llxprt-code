/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { SettingsService } from '../settings/SettingsService.js';
import {
  getActiveProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';
import { DebugLogger } from '../debug/index.js';
import { getProviderKeyStorage } from '../storage/provider-key-storage.js';
import { type OAuthToken } from './types.js';
import { debugLogger } from '../utils/debugLogger.js';
import type {
  AuthPrecedenceConfig,
  OAuthManager,
  OAuthTokenRequestMetadata,
  RuntimeScopedState,
} from './precedence.js';
import {
  buildCacheKey,
  ensureRuntimeState,
  flushRuntimeAuthScope,
  getValidCachedEntry,
  invalidateEntry,
  invalidateMatchingEntries,
  recordCacheHit,
  recordCacheMiss,
  registerSettingsSubscriptions,
  resolveProfileId,
  runtimeScopedStates,
  storeRuntimeScopedToken,
} from './precedence.js';

const logger = new DebugLogger('llxprt:auth:precedence');

interface ResolveAuthOptions {
  settingsService?: SettingsService | null;
  includeOAuth?: boolean;
}

interface OAuthResolutionContext {
  settingsService: SettingsService;
  providerKey: string | undefined;
  providerId: string;
  profileId: string | null;
  profileScopeId: string;
  runtimeContext: ProviderRuntimeContext | null;
  runtimeState: RuntimeScopedState | null;
}

interface OAuthEnablementManager extends OAuthManager {
  isOAuthEnabled?(provider: string): boolean | Promise<boolean | undefined>;
}

function isAuthOnlyEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
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
    this.settingsService = settingsService ?? undefined;
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 1-2
   */
  private resolveSettingsService(
    override?: SettingsService | null,
  ): SettingsService {
    if (override != null) return override;
    if (this.settingsService != null) return this.settingsService;
    const context = getActiveProviderRuntimeContext();
    const settingsService = (
      context as { settingsService?: SettingsService | null }
    ).settingsService;
    if (settingsService == null) {
      throw new Error('Active provider runtime context not available');
    }
    this.settingsService = settingsService;
    return settingsService;
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
    const providerKey = this.normalizeProviderId(this.config.providerId);
    if (!isAuthOnlyEnabled(settingsService.get('authOnly'))) {
      const nonOAuthAuth = await this.resolveNonOAuthAuthentication(
        settingsService,
        providerKey,
      );
      if (nonOAuthAuth !== null) return nonOAuthAuth;
    }
    if (!this.canResolveOAuth(includeOAuth)) return null;
    return this.resolveOAuthAuthentication(settingsService, providerKey);
  }

  private async resolveNonOAuthAuthentication(
    settingsService: SettingsService,
    providerKey: string | undefined,
  ): Promise<string | null> {
    const directAuth = await this.resolveDirectAuthentication(
      settingsService,
      providerKey,
    );
    if (directAuth !== null) return directAuth;
    const envAuth = this.resolveEnvironmentAuthentication();
    return envAuth ?? null;
  }

  private async resolveDirectAuthentication(
    settingsService: SettingsService,
    providerKey: string | undefined,
  ): Promise<string | null> {
    const providerAuth = await this.resolveProviderAuthentication(
      settingsService,
      providerKey,
    );
    if (providerAuth !== null) return providerAuth;
    const configAuth = this.normalizeAuthValue(this.config.apiKey ?? null);
    if (configAuth !== undefined) return configAuth;
    return this.resolveGlobalAuthentication(settingsService, providerKey);
  }

  private async resolveProviderAuthentication(
    settingsService: SettingsService,
    providerKey: string | undefined,
  ): Promise<string | null> {
    const providerSettings =
      providerKey !== undefined &&
      typeof settingsService.getProviderSettings === 'function'
        ? settingsService.getProviderSettings(providerKey)
        : undefined;
    const providerAuthKey = this.normalizeAuthValue(
      providerSettings?.['auth-key'] ?? providerSettings?.apiKey,
    );
    if (providerAuthKey !== undefined) return providerAuthKey;
    const providerAuthKeyfile = this.normalizeAuthValue(
      providerSettings?.['auth-keyfile'] ?? providerSettings?.apiKeyfile,
    );
    return this.resolveKeyFileAuth(providerAuthKeyfile);
  }

  private async resolveGlobalAuthentication(
    settingsService: SettingsService,
    providerKey: string | undefined,
  ): Promise<string | null> {
    if (!this.shouldUseGlobalAuth(settingsService, providerKey)) return null;
    const authKey = this.normalizeAuthValue(settingsService.get('auth-key'));
    if (authKey !== undefined) return authKey;
    const authKeyName = this.normalizeAuthValue(
      settingsService.get('auth-key-name'),
    );
    if (authKeyName !== undefined) return this.resolveNamedKey(authKeyName);
    const authKeyfile = this.normalizeAuthValue(
      settingsService.get('auth-keyfile'),
    );
    return this.resolveKeyFileAuth(authKeyfile);
  }

  private async resolveKeyFileAuth(
    keyFile: string | undefined,
  ): Promise<string | null> {
    if (keyFile === undefined) return null;
    const keyFromFile = await this.readKeyFile(keyFile);
    return keyFromFile ?? null;
  }

  private resolveEnvironmentAuthentication(): string | undefined {
    if (
      this.config.envKeyNames == null ||
      this.config.envKeyNames.length === 0
    ) {
      return undefined;
    }
    for (const envVarName of this.config.envKeyNames) {
      const envValue = this.normalizeAuthValue(process.env[envVarName]);
      if (envValue !== undefined) return envValue;
    }
    return undefined;
  }

  private canResolveOAuth(includeOAuth: boolean): boolean {
    if (!includeOAuth) return false;
    if (this.config.isOAuthEnabled !== true) return false;
    if (this.config.supportsOAuth !== true) return false;
    return this.oauthManager != null && this.config.oauthProvider != null;
  }

  private async resolveOAuthAuthentication(
    settingsService: SettingsService,
    providerKey: string | undefined,
  ): Promise<string | null> {
    const context = this.buildOAuthContext(settingsService, providerKey);
    if ((await this.isOAuthDisabledByManager()) === true) {
      this.invalidateDisabledOAuthEntry(context);
      return null;
    }
    const cachedToken = this.getCachedOAuthToken(context);
    if (cachedToken !== null) return cachedToken;
    return this.fetchAndCacheOAuthToken(context);
  }

  private buildOAuthContext(
    settingsService: SettingsService,
    providerKey: string | undefined,
  ): OAuthResolutionContext {
    const providerId = this.resolveProviderIdentifier(providerKey);
    const profileId = resolveProfileId(settingsService);
    const runtime = this.tryGetRuntimeState(settingsService, providerId);
    return {
      settingsService,
      providerKey,
      providerId,
      profileId,
      profileScopeId: profileId ?? 'no-profile',
      runtimeContext: runtime.runtimeContext,
      runtimeState: runtime.runtimeState,
    };
  }

  private tryGetRuntimeState(
    settingsService: SettingsService,
    providerId: string,
  ): {
    runtimeContext: ProviderRuntimeContext | null;
    runtimeState: RuntimeScopedState | null;
  } {
    try {
      const runtimeContext = getActiveProviderRuntimeContext();
      const runtimeState = ensureRuntimeState(runtimeContext);
      registerSettingsSubscriptions(runtimeState, settingsService, providerId);
      return { runtimeContext, runtimeState };
    } catch {
      return { runtimeContext: null, runtimeState: null };
    }
  }

  private async isOAuthDisabledByManager(): Promise<boolean> {
    const managerWithCheck = this.oauthManager as
      | OAuthEnablementManager
      | undefined;
    if (typeof managerWithCheck?.isOAuthEnabled !== 'function') return false;
    try {
      const enabledResult = managerWithCheck.isOAuthEnabled(
        this.config.oauthProvider!,
      );
      return (await enabledResult) === false;
    } catch (error) {
      this.debugOAuthEnablementError(error);
      return false;
    }
  }

  private debugOAuthEnablementError(error: unknown): void {
    if (process.env.DEBUG) {
      debugLogger.debug(
        `Failed to determine OAuth enablement for ${this.config.oauthProvider}:`,
        error,
      );
    }
  }

  private invalidateDisabledOAuthEntry(context: OAuthResolutionContext): void {
    const runtimeState = context.runtimeState;
    if (runtimeState == null) return;
    const cacheKey = buildCacheKey(
      runtimeState.runtimeAuthScopeId,
      context.providerId,
      context.profileScopeId,
    );
    if (runtimeState.entries.has(cacheKey)) {
      invalidateEntry(runtimeState, cacheKey, 'oauth-disabled');
    }
  }

  private getCachedOAuthToken(context: OAuthResolutionContext): string | null {
    const runtimeState = context.runtimeState;
    if (runtimeState == null) return null;
    const cachedEntry = getValidCachedEntry(
      runtimeState,
      context.providerId,
      context.profileScopeId,
    );
    if (cachedEntry !== null) {
      recordCacheHit(runtimeState);
      return cachedEntry.token;
    }
    recordCacheMiss(runtimeState);
    return null;
  }

  private async fetchAndCacheOAuthToken(
    context: OAuthResolutionContext,
  ): Promise<string | null> {
    try {
      const requestMetadata = this.buildOAuthRequestMetadata(context);
      const token = await this.oauthManager!.getToken(
        this.config.oauthProvider!,
        requestMetadata,
      );
      if (token == null || token === '') return null;
      const oauthToken = await this.tryGetOAuthTokenMetadata(requestMetadata);
      this.storeOAuthTokenMetadata(context, token, oauthToken);
      return token;
    } catch (error) {
      this.debugOAuthTokenError(error);
      return null;
    }
  }

  private buildOAuthRequestMetadata(
    context: OAuthResolutionContext,
  ): OAuthTokenRequestMetadata {
    const runtimeMetadata = this.extractRuntimeMetadata(context.runtimeContext);
    return {
      runtimeAuthScopeId:
        context.runtimeState?.runtimeAuthScopeId ?? 'no-runtime',
      providerId: context.providerId,
      profileId: context.profileId ?? undefined,
      cliScope: runtimeMetadata,
      runtimeMetadata,
    };
  }

  private extractRuntimeMetadata(
    runtimeContext: ProviderRuntimeContext | null,
  ): Record<string, unknown> | undefined {
    const metadata = runtimeContext?.metadata;
    return metadata != null && typeof metadata === 'object'
      ? metadata
      : undefined;
  }

  private storeOAuthTokenMetadata(
    context: OAuthResolutionContext,
    token: string,
    oauthToken: OAuthToken | null,
  ): void {
    const runtimeState = context.runtimeState;
    if (runtimeState == null) return;
    storeRuntimeScopedToken(
      runtimeState,
      context.providerId,
      context.profileScopeId,
      token,
      oauthToken,
    );
  }

  private async tryGetOAuthTokenMetadata(
    requestMetadata: OAuthTokenRequestMetadata,
  ): Promise<OAuthToken | null> {
    if (typeof this.oauthManager?.getOAuthToken !== 'function') return null;
    try {
      return await this.oauthManager.getOAuthToken(
        this.config.oauthProvider!,
        requestMetadata,
      );
    } catch (tokenError) {
      if (process.env.DEBUG) {
        debugLogger.debug(
          `Failed to fetch OAuth token metadata for ${this.config.oauthProvider}:`,
          tokenError,
        );
      }
      return null;
    }
  }

  private debugOAuthTokenError(error: unknown): void {
    if (process.env.DEBUG) {
      debugLogger.warn(
        `Failed to get OAuth token for ${this.config.oauthProvider}:`,
        error,
      );
    }
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
    const globalMethod = await this.getGlobalAuthMethodName(settingsService);
    if (globalMethod !== null) return globalMethod;
    const configMethod = this.getConfigAuthMethodName();
    if (configMethod !== null) return configMethod;
    return this.getOAuthMethodName();
  }

  private async getGlobalAuthMethodName(
    settingsService: SettingsService,
  ): Promise<string | null> {
    const authKey = settingsService.get('auth-key');
    if (typeof authKey === 'string' && authKey.trim() !== '') {
      return 'command-key';
    }
    if (
      this.normalizeAuthValue(settingsService.get('auth-key-name')) !==
      undefined
    ) {
      return 'named-key';
    }
    return this.getKeyFileMethodName(settingsService.get('auth-keyfile'));
  }

  private async getKeyFileMethodName(value: unknown): Promise<string | null> {
    if (typeof value !== 'string' || value === '') return null;
    try {
      const keyFromFile = await this.readKeyFile(value);
      return keyFromFile !== null ? 'command-keyfile' : null;
    } catch {
      return null;
    }
  }

  private getConfigAuthMethodName(): string | null {
    if (
      typeof this.config.apiKey === 'string' &&
      this.config.apiKey.trim() !== ''
    ) {
      return 'constructor-apikey';
    }
    const envAuthName = this.getEnvironmentAuthMethodName();
    return envAuthName ?? null;
  }

  private getEnvironmentAuthMethodName(): string | undefined {
    if (
      this.config.envKeyNames == null ||
      this.config.envKeyNames.length === 0
    ) {
      return undefined;
    }
    for (const envVarName of this.config.envKeyNames) {
      const envValue = process.env[envVarName];
      if (typeof envValue === 'string' && envValue.trim() !== '') {
        return `env-${envVarName.toLowerCase()}`;
      }
    }
    return undefined;
  }

  private async getOAuthMethodName(): Promise<string | null> {
    if (!this.canResolveOAuth(true)) return null;
    try {
      const isAuthenticated = await this.oauthManager!.isAuthenticated(
        this.config.oauthProvider!,
      );
      return isAuthenticated ? `oauth-${this.config.oauthProvider}` : null;
    } catch {
      return null;
    }
  }

  private normalizeAuthValue(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === '' || trimmed.toLowerCase() === 'none'
      ? undefined
      : trimmed;
  }

  private normalizeProviderId(value?: string | null): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }

  private resolveProviderIdentifier(preferredProviderId?: string): string {
    const providerId = this.normalizeProviderId(preferredProviderId);
    if (providerId !== undefined) return providerId;
    const oauthProvider = this.normalizeProviderId(this.config.oauthProvider);
    if (oauthProvider !== undefined) return oauthProvider;
    return this.config.envKeyNames?.[0] ?? 'unknown-provider';
  }

  private shouldUseGlobalAuth(
    settingsService: SettingsService,
    providerId?: string,
  ): boolean {
    if (providerId === undefined) return true;
    const activeProvider = settingsService.get('activeProvider');
    if (typeof activeProvider !== 'string') return true;
    const trimmed = activeProvider.trim();
    return trimmed === '' || trimmed === providerId;
  }

  private async resolveNamedKey(name: string): Promise<string> {
    const trimmedName = this.normalizeAuthValue(name);
    if (trimmedName === undefined) {
      throw new Error('Named key reference is empty');
    }
    const storage = getProviderKeyStorage();
    const key = this.normalizeAuthValue(await storage.getKey(trimmedName));
    if (key === undefined) {
      throw new Error(
        `Named key '${trimmedName}' not found. Save it with /key save ${trimmedName} <api-key> before retrying.`,
      );
    }
    return key;
  }

  /**
   * Reads API key from a file path, handling tilde expansion, absolute and relative paths
   */
  private async readKeyFile(filePath: string): Promise<string | null> {
    try {
      const expandedPath = filePath.startsWith('~')
        ? path.join(os.homedir(), filePath.slice(1))
        : filePath;
      const resolvedPath = path.isAbsolute(expandedPath)
        ? expandedPath
        : path.resolve(process.cwd(), expandedPath);
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const key = content.trim();
      if (key === '') {
        if (process.env.DEBUG) {
          debugLogger.warn(`Key file ${filePath} is empty`);
        }
        return null;
      }
      return key;
    } catch (error) {
      if (process.env.DEBUG) {
        debugLogger.warn(`Failed to read key file ${filePath}:`, error);
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

  /**
   * Invalidates the cached OAuth tokens for this resolver.
   * This should be called during logout to ensure fresh tokens are fetched
   * on the next authentication attempt.
   *
   * @plan PLAN-20251023-STATELESS-HARDENING
   * @requirement Issue #975 - OAuth logout cache invalidation
   */
  invalidateCache(): void {
    const knownRuntimeIds = ['legacy-singleton', 'provider-manager-singleton'];
    try {
      const { runtimeId } = getActiveProviderRuntimeContext();
      if (
        typeof runtimeId === 'string' &&
        runtimeId !== '' &&
        !knownRuntimeIds.includes(runtimeId)
      ) {
        knownRuntimeIds.push(runtimeId);
      }
    } catch {
      // Context not available, proceed with known IDs
    }
    for (const runtimeId of knownRuntimeIds) {
      try {
        flushRuntimeAuthScope(runtimeId);
      } catch (error) {
        logger.debug(
          () => `Failed to flush runtime auth scope ${runtimeId}: ${error}`,
        );
      }
    }
  }

  /**
   * Invalidates cached OAuth tokens for a specific provider.
   * This enables surgical cache invalidation for a single provider rather than
   * the all-or-nothing invalidateCache() behavior.
   *
   * @param providerId - The provider ID to invalidate cache entries for
   * @param profileId - Optional profile ID to invalidate only that specific profile
   * @fix issue1861 - Token revocation handling
   */
  invalidateProviderCache(providerId: string, profileId?: string): void {
    for (const [, state] of runtimeScopedStates) {
      invalidateMatchingEntries(
        state,
        (entry) => {
          if (entry.providerId !== providerId) return false;
          if (profileId !== undefined && entry.profileId !== profileId) {
            return false;
          }
          return true;
        },
        'token-revoked',
      );
    }
  }
}
