/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageBus, Config } from '@vybestack/llxprt-code-core';

// Re-export core auth types for CLI usage
export type {
  OAuthToken,
  AuthStatus,
  TokenStore,
  OAuthTokenRequestMetadata,
} from '@vybestack/llxprt-code-core';

export { KeyringTokenStore } from '@vybestack/llxprt-code-core';

/**
 * Runtime dependencies for OAuthManager that include MessageBus integration.
 * These are injected at runtime from the session composition root.
 */
export interface OAuthManagerRuntimeMessageBusDeps {
  messageBus?: MessageBus;
  config?: Config;
}

/**
 * Interface for OAuth provider abstraction.
 * Each provider (e.g., Anthropic, Gemini, Qwen) implements this interface.
 */
export interface OAuthProvider {
  /** Provider name (e.g., 'gemini', 'qwen') */
  name: string;

  /**
   * Initiate OAuth authentication flow.
   * This starts the device flow or opens browser for auth.
   * @returns The OAuth token obtained from the authentication flow
   */
  initiateAuth(): Promise<import('@vybestack/llxprt-code-core').OAuthToken>;

  /**
   * Get current OAuth token for this provider.
   * @returns OAuth token if available, null otherwise
   */
  getToken(): Promise<import('@vybestack/llxprt-code-core').OAuthToken | null>;

  /**
   * Refresh a specific token (bucket-aware via the passed token).
   * Implementations must NOT persist; OAuthManager owns persistence.
   * @returns Refreshed token or null if refresh failed
   */
  refreshToken(
    currentToken: import('@vybestack/llxprt-code-core').OAuthToken,
  ): Promise<import('@vybestack/llxprt-code-core').OAuthToken | null>;

  /**
   * Optional provider-side logout/revoke for a specific token.
   * OAuthManager always clears local storage for the selected bucket.
   */
  logout?(
    token?: import('@vybestack/llxprt-code-core').OAuthToken,
  ): Promise<void>;

  /**
   * Optional method to check authentication status independently of the token store.
   * This is intended for providers that manage authentication externally
   * (e.g., Gemini's LOGIN_WITH_GOOGLE) where the manager's token-store/expiry
   * check is not the source of truth.
   *
   * Contract constraint: This method is ONLY consulted when isOAuthEnabled(providerName)
   * is true. Providers that use the standard token-store flow should NOT implement
   * this method — their auth status is correctly determined by the default
   * token-store + expiry check.
   *
   * @returns true if the provider can confirm authentication status, false otherwise
   */
  isAuthenticated?(): Promise<boolean>;
}

/**
 * Interface for triggering authentication flows from the token access layer.
 * Implemented by AuthFlowOrchestrator (Phase 6); injected into TokenAccessCoordinator
 * via setAuthenticator() to avoid a module import cycle.
 */
export interface AuthenticatorInterface {
  authenticate(providerName: string, bucket?: string): Promise<void>;
  authenticateMultipleBuckets(
    providerName: string,
    buckets: string[],
    requestMetadata?: import('@vybestack/llxprt-code-core').OAuthTokenRequestMetadata,
  ): Promise<void>;
}

/**
 * Narrow interface for the subset of OAuthManager that BucketFailoverHandlerImpl
 * needs. Both TokenAccessCoordinator and AuthFlowOrchestrator receive a reference
 * satisfying this interface (the OAuthManager facade itself).
 */
export interface BucketFailoverOAuthManagerLike {
  getSessionBucket(
    provider: string,
    metadata?: import('@vybestack/llxprt-code-core').OAuthTokenRequestMetadata,
  ): string | undefined;
  setSessionBucket(
    provider: string,
    bucket: string,
    metadata?: import('@vybestack/llxprt-code-core').OAuthTokenRequestMetadata,
  ): void;
  getOAuthToken(
    providerName: string,
    bucket?: string,
  ): Promise<import('@vybestack/llxprt-code-core').OAuthToken | null>;
  authenticate(providerName: string, bucket?: string): Promise<void>;
  authenticateMultipleBuckets(
    providerName: string,
    buckets: string[],
    requestMetadata?: import('@vybestack/llxprt-code-core').OAuthTokenRequestMetadata,
  ): Promise<void>;
  getTokenStore(): import('@vybestack/llxprt-code-core').TokenStore;
}
