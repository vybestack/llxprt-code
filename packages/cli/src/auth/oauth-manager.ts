/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuthToken, AuthStatus, TokenStore } from './types.js';
import type {
  OAuthProvider,
  OAuthManagerRuntimeMessageBusDeps,
  BucketFailoverOAuthManagerLike,
} from './types.js';
import { LoadedSettings } from '../config/settings.js';
import { ProviderRegistry } from './provider-registry.js';
import {
  MessageBus,
  Config,
  type OAuthTokenRequestMetadata,
} from '@vybestack/llxprt-code-core';
import { ProactiveRenewalManager } from './proactive-renewal-manager.js';
import { OAuthBucketManager } from './OAuthBucketManager.js';
import { TokenAccessCoordinator } from './token-access-coordinator.js';
import { AuthFlowOrchestrator } from './auth-flow-orchestrator.js';
import { AuthStatusService } from './auth-status-service.js';
import {
  getAnthropicUsageInfo,
  getAllAnthropicUsageInfo,
  getAllCodexUsageInfo,
  getAllGeminiUsageInfo,
  getHigherPriorityAuth,
} from './provider-usage-info.js';

/**
 * OAuth Manager coordinates multiple OAuth providers
 * Provides unified interface for authentication across providers
 */
export class OAuthManager implements BucketFailoverOAuthManagerLike {
  private providerRegistry: ProviderRegistry;
  private tokenStore: TokenStore;
  private settings?: LoadedSettings;
  private readonly bucketManager: OAuthBucketManager;
  private proactiveRenewalManager: ProactiveRenewalManager;
  private readonly tokenAccessCoordinator: TokenAccessCoordinator;
  private readonly authFlowOrchestrator: AuthFlowOrchestrator;
  private readonly authStatusService: AuthStatusService;
  private _runtimeMessageBus?: MessageBus;
  private readonly config?: Config;

  /**
   * Getter/setter for runtimeMessageBus.
   * The setter propagates changes to AuthFlowOrchestrator so that test code
   * using Object.assign(manager, { runtimeMessageBus }) correctly reaches the
   * orchestrator that actually uses the bus.
   */
  get runtimeMessageBus(): MessageBus | undefined {
    return this._runtimeMessageBus;
  }

  set runtimeMessageBus(bus: MessageBus | undefined) {
    this._runtimeMessageBus = bus;
    // Propagate to the orchestrator if it has been constructed.
    // During construction this.authFlowOrchestrator may not exist yet,
    // so the conditional guard is required.
    if (this.authFlowOrchestrator) {
      this.authFlowOrchestrator.setRuntimeMessageBus(bus);
    }
  }

  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P06
   * @requirement REQ-D01-003.3
   * @requirement REQ-D01-004.3
   * @pseudocode lines 73-82
   */
  constructor(
    tokenStore: TokenStore,
    settings?: LoadedSettings,
    runtimeDeps?: OAuthManagerRuntimeMessageBusDeps,
  ) {
    this.providerRegistry = new ProviderRegistry(settings);
    this.tokenStore = tokenStore;
    this.settings = settings;
    this.runtimeMessageBus = runtimeDeps?.messageBus;
    this.config = runtimeDeps?.config;
    this.bucketManager = new OAuthBucketManager(tokenStore);
    this.proactiveRenewalManager = new ProactiveRenewalManager(
      tokenStore,
      (name: string) => this.providerRegistry.getProvider(name),
      (name: string) => this.isOAuthEnabled(name),
    );
    this.authFlowOrchestrator = new AuthFlowOrchestrator(
      tokenStore,
      this.providerRegistry,
      this, // facadeRef — satisfies BucketFailoverOAuthManagerLike
      runtimeDeps?.config,
      runtimeDeps?.messageBus,
    );
    this.tokenAccessCoordinator = new TokenAccessCoordinator(
      tokenStore,
      this.providerRegistry,
      this.proactiveRenewalManager,
      this.bucketManager,
      this, // facadeRef — satisfies BucketFailoverOAuthManagerLike
      settings,
      // Pass a getter so the coordinator always reads the live config value,
      // even if tests mutate manager.config after construction.
      () => this.config,
    );
    // Wire getProfileBuckets delegate so that test spies on the private
    // manager.getProfileBuckets method correctly intercept internal calls
    // made by the coordinator (coordinator calls the delegate → facade method
    // → coordinator.doGetProfileBuckets, breaking the chain for spies).
    this.tokenAccessCoordinator.setGetProfileBucketsDelegate(
      (name: string, meta?: OAuthTokenRequestMetadata) =>
        this.getProfileBuckets(name, meta),
    );
    // Wire authenticator to the AuthFlowOrchestrator instance
    this.tokenAccessCoordinator.setAuthenticator(this.authFlowOrchestrator);
    // AuthStatusService owns auth-status checking, logout, and cache invalidation
    this.authStatusService = new AuthStatusService(
      tokenStore,
      this.providerRegistry,
      this.proactiveRenewalManager,
      this.bucketManager,
      this.tokenAccessCoordinator,
    );
  }

  /**
   * Register an OAuth provider with the manager
   * @param provider - The OAuth provider to register
   */
  registerProvider(provider: OAuthProvider): void {
    this.providerRegistry.registerProvider(provider);
  }

  /**
   * Get a registered OAuth provider
   * @param name - Provider name
   * @returns OAuth provider or undefined if not registered
   */
  getProvider(name: string): OAuthProvider | undefined {
    return this.providerRegistry.getProvider(name);
  }

  /**
   * Authenticate with a specific provider
   * @param providerName - Name of the provider to authenticate with
   * @param bucket - Optional bucket name for multi-account support
   */
  async authenticate(providerName: string, bucket?: string): Promise<void> {
    return this.authFlowOrchestrator.authenticate(providerName, bucket);
  }

  /**
   * Get authentication status for all registered providers
   * @returns Array of authentication status for each provider
   */
  async getAuthStatus(): Promise<AuthStatus[]> {
    return this.authStatusService.getAuthStatus();
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P14
   * @requirement REQ-002
   * @pseudocode lines 51-68
   * Check if authenticated with a specific provider (required by precedence resolver)
   * @param providerName - Name of the provider
   * @param bucket - Optional bucket name
   * @returns True if authenticated, false otherwise
   */
  async isAuthenticated(
    providerName: string,
    bucket?: string,
  ): Promise<boolean> {
    return this.authStatusService.isAuthenticated(providerName, bucket);
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P14
   * @requirement REQ-002.1
   * @pseudocode lines 4-37
   * Logout from a specific provider by clearing stored tokens
   * @param providerName - Name of the provider to logout from
   * @param bucket - Optional bucket name for multi-account support
   */
  async logout(providerName: string, bucket?: string): Promise<void> {
    return this.authStatusService.logout(providerName, bucket);
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P14
   * @requirement REQ-002
   * @pseudocode lines 39-49
   * Logout from all providers by clearing all stored tokens
   */
  async logoutAll(): Promise<void> {
    return this.authStatusService.logoutAll();
  }

  /**
   * Get OAuth token for a specific provider.
   * Delegates to TokenAccessCoordinator.
   */
  async getToken(
    providerName: string,
    bucket?: string | unknown,
  ): Promise<string | null> {
    return this.tokenAccessCoordinator.getToken(providerName, bucket);
  }

  /**
   * Retrieve the stored OAuth token without refreshing it.
   * Delegates to TokenAccessCoordinator.
   */
  async peekStoredToken(providerName: string): Promise<OAuthToken | null> {
    return this.tokenAccessCoordinator.peekStoredToken(providerName);
  }

  /**
   * Get OAuth token object for a specific provider.
   * Delegates to TokenAccessCoordinator.
   */
  async getOAuthToken(
    providerName: string,
    bucket?: string | unknown,
  ): Promise<OAuthToken | null> {
    return this.tokenAccessCoordinator.getOAuthToken(providerName, bucket);
  }

  /**
   * Delegate proactive renewal execution to ProactiveRenewalManager.
   * Exposed for tests that cast to access it via private cast.
   */
  async runProactiveRenewal(
    providerName: string,
    bucket: string,
  ): Promise<void> {
    return this.proactiveRenewalManager.runProactiveRenewal(
      providerName,
      bucket,
    );
  }

  async configureProactiveRenewalsForProfile(profile: unknown): Promise<void> {
    return this.proactiveRenewalManager.configureProactiveRenewalsForProfile(
      profile,
    );
  }

  /**
   * Get list of all registered provider names
   * @returns Array of provider names
   */
  getSupportedProviders(): string[] {
    return this.providerRegistry.getSupportedProviders();
  }

  /**
   * Toggle OAuth enablement for a provider
   * @param providerName - Name of the provider
   * @returns New enablement state (true if enabled, false if disabled)
   */
  async toggleOAuthEnabled(providerName: string): Promise<boolean> {
    return this.providerRegistry.toggleOAuthEnabled(providerName);
  }

  /**
   * Check if OAuth is enabled for a provider
   * @param providerName - Name of the provider
   * @returns True if OAuth is enabled, false otherwise
   */
  isOAuthEnabled(providerName: string): boolean {
    return this.providerRegistry.isOAuthEnabled(providerName);
  }

  getTokenStore(): TokenStore {
    return this.tokenStore;
  }

  /**
   * Check for higher priority authentication methods
   * @param providerName - Name of the provider to check
   * @returns String describing higher priority auth method, null if none
   */
  async getHigherPriorityAuth(providerName: string): Promise<string | null> {
    return getHigherPriorityAuth(providerName, this.settings);
  }

  /**
   * Set session bucket override for a provider
   * Session state is in-memory only and not persisted
   */
  setSessionBucket(
    provider: string,
    bucket: string,
    metadata?: OAuthTokenRequestMetadata,
  ): void {
    this.bucketManager.setSessionBucket(provider, bucket, metadata);
  }

  /**
   * Get session bucket override for a provider
   * Returns undefined if no session override set
   */
  getSessionBucket(
    provider: string,
    metadata?: OAuthTokenRequestMetadata,
  ): string | undefined {
    return this.bucketManager.getSessionBucket(provider, metadata);
  }

  private async getCurrentProfileSessionBucket(
    provider: string,
    metadata?: OAuthTokenRequestMetadata,
  ): Promise<string | undefined> {
    return this.tokenAccessCoordinator.getCurrentProfileSessionBucket(
      provider,
      metadata,
    );
  }

  /**
   * Delegate to coordinator's real getProfileBuckets implementation.
   * Exists as a private method on the facade so that test spies placed on
   * (manager as unknown as { getProfileBuckets }).getProfileBuckets correctly
   * intercept all internal bucket-resolution calls made by the coordinator
   * (coordinator calls its _getProfileBucketsDelegate → this method → coordinator.doGetProfileBuckets).
   */
  private async getProfileBuckets(
    providerName: string,
    metadata?: OAuthTokenRequestMetadata,
  ): Promise<string[]> {
    return this.tokenAccessCoordinator.doGetProfileBuckets(
      providerName,
      metadata,
    );
  }

  /**
   * Clear session bucket override for a provider
   */
  clearSessionBucket(
    provider: string,
    metadata?: OAuthTokenRequestMetadata,
  ): void {
    this.bucketManager.clearSessionBucket(provider, metadata);
  }

  clearAllSessionBuckets(provider: string): void {
    this.bucketManager.clearAllSessionBuckets(provider);
  }

  /**
   * Logout from all buckets for a provider
   */
  async logoutAllBuckets(provider: string): Promise<void> {
    return this.authStatusService.logoutAllBuckets(provider);
  }

  async listBuckets(provider: string): Promise<string[]> {
    return this.authStatusService.listBuckets(provider);
  }

  /**
   * Get authentication status with bucket information
   */
  async getAuthStatusWithBuckets(provider: string): Promise<
    Array<{
      bucket: string;
      authenticated: boolean;
      expiry?: number;
      isSessionBucket: boolean;
    }>
  > {
    return this.authStatusService.getAuthStatusWithBuckets(provider);
  }

  /**
   * Get Anthropic usage information from OAuth endpoint for a specific bucket.
   * Resolves the bucket via current profile session metadata when not specified.
   * Returns full usage data for Claude Code/Max plans.
   * Only works with OAuth tokens (sk-ant-oat01-...), not API keys.
   * @param bucket - Optional bucket name, defaults to current session bucket or 'default'
   */
  async getAnthropicUsageInfo(
    bucket?: string,
  ): Promise<Record<string, unknown> | null> {
    const provider = this.providerRegistry.getProvider('anthropic');
    if (!provider) {
      return null;
    }

    const sessionMetadata =
      await this.getCurrentProfileSessionMetadata('anthropic');

    const bucketToUse =
      bucket ??
      (await this.getCurrentProfileSessionBucket(
        'anthropic',
        sessionMetadata,
      )) ??
      'default';

    return getAnthropicUsageInfo(this.tokenStore, bucketToUse);
  }

  /**
   * Get Anthropic usage information for all authenticated buckets.
   * Returns a map of bucket name to usage info for all buckets that have valid OAuth tokens.
   */
  async getAllAnthropicUsageInfo(): Promise<
    Map<string, Record<string, unknown>>
  > {
    return getAllAnthropicUsageInfo(this.tokenStore);
  }

  /**
   * Get Codex usage information for all authenticated buckets.
   * Returns a map of bucket name to usage info for all buckets that have valid OAuth tokens with account_id.
   */
  async getAllCodexUsageInfo(): Promise<Map<string, Record<string, unknown>>> {
    return getAllCodexUsageInfo(this.tokenStore, this.config);
  }

  /**
   * Get Gemini quota information for all authenticated buckets.
   * Uses the CodeAssist retrieveUserQuota API via direct HTTP calls.
   * Returns a map of bucket name to quota response.
   */
  async getAllGeminiUsageInfo(): Promise<Map<string, Record<string, unknown>>> {
    return getAllGeminiUsageInfo(this.tokenStore);
  }

  private async getCurrentProfileSessionMetadata(
    providerName: string,
  ): Promise<OAuthTokenRequestMetadata | undefined> {
    return this.tokenAccessCoordinator.getCurrentProfileSessionMetadata(
      providerName,
    );
  }

  /**
   * Authenticate multiple OAuth buckets sequentially.
   * Delegates to AuthFlowOrchestrator.
   */
  async authenticateMultipleBuckets(
    providerName: string,
    buckets: string[],
    requestMetadata?: OAuthTokenRequestMetadata,
  ): Promise<void> {
    return this.authFlowOrchestrator.authenticateMultipleBuckets(
      providerName,
      buckets,
      requestMetadata,
    );
  }

  /**
   * Force refresh a token when it is known to be revoked (401/403 error).
   * Delegates to TokenAccessCoordinator.
   * @param providerName - Name of the provider
   * @param failedAccessToken - The access token that was rejected
   * @param bucket - Optional bucket name
   * @returns The refreshed token, or null if refresh was not possible
   * @fix issue1861 - Token revocation handling
   */
  async forceRefreshToken(
    providerName: string,
    failedAccessToken: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    return this.tokenAccessCoordinator.forceRefreshToken(
      providerName,
      failedAccessToken,
      bucket,
    );
  }
}
