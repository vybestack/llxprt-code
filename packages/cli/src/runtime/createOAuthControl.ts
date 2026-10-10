/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { OAuthControl } from '../ui/contexts/OAuthControlContext.js';
import { discoverProviderBuckets } from '../ui/commands/oauthBucketDiscovery.js';

function clearProviderClientCache(
  providerManager: RuntimeProviderManager,
  provider: string,
): void {
  const instance = providerManager.getProviderByName(provider);
  if (
    instance &&
    'clearClientCache' in instance &&
    typeof instance.clearClientCache === 'function'
  )
    instance.clearClientCache();
}

export function createOAuthControl(
  readOAuthManager: () => OAuthManager | undefined,
  providerManager: RuntimeProviderManager,
): OAuthControl {
  const manager = (): OAuthManager => {
    const current = readOAuthManager();
    if (!(current instanceof OAuthManager))
      throw new Error('OAuth runtime infrastructure is unavailable.');
    return current;
  };
  return {
    clearProviderClientCache: (provider) =>
      clearProviderClientCache(providerManager, provider),
    isAvailable: () => readOAuthManager() instanceof OAuthManager,
    discoverBuckets: (logger) => discoverProviderBuckets(manager(), logger),
    readStoredTokenSummary: async (provider, bucket) => {
      const token = await manager().getTokenStore().getToken(provider, bucket);
      if (!token) return null;
      return {
        ...(typeof token.expiry === 'number' ? { expiry: token.expiry } : {}),
        hasRefreshToken: Boolean(token.refresh_token),
      };
    },
    readCodexBucketToken: (bucket) =>
      manager().getTokenStore().getToken('codex', bucket),
    getAuthStatus: () => manager().getAuthStatus(),
    toggleOAuthEnabled: (provider) => manager().toggleOAuthEnabled(provider),
    authenticate: (provider, bucket, options) =>
      manager().authenticate(provider, bucket, options),
    getSupportedProviders: () => manager().getSupportedProviders(),
    listBuckets: (provider) => manager().listBuckets(provider),
    isOAuthEnabled: (provider) => manager().isOAuthEnabled(provider),
    isAuthenticated: (provider, bucket) =>
      manager().isAuthenticated(provider, bucket),
    peekStoredToken: (provider) => manager().peekStoredToken(provider),
    getHigherPriorityAuth: (provider) =>
      manager().getHigherPriorityAuth(provider),
    activateNamedLoginBucket: (provider, bucket) =>
      manager().activateNamedLoginBucket(provider, bucket),
    logoutAllBuckets: (provider) => manager().logoutAllBuckets(provider),
    logout: (provider, bucket) => manager().logout(provider, bucket),
    clearSessionBucket: (provider) => manager().clearSessionBucket(provider),
    getAuthStatusWithBuckets: (provider) =>
      manager().getAuthStatusWithBuckets(provider),
    setSessionBucket: (provider, bucket) =>
      manager().setSessionBucket(provider, bucket),
    getSessionBucket: (provider) => manager().getSessionBucket(provider),
    inspectAuthLock: (provider, bucket) =>
      manager().inspectAuthLock(provider, bucket),
    forceRecoverAuthLock: (provider, bucket, options) =>
      manager().forceRecoverAuthLock(provider, bucket, options),
    recoverAuthLock: (provider, bucket) =>
      manager().recoverAuthLock(provider, bucket),
    clearBrowserProfileAssociation: (provider, bucket) =>
      manager().clearBrowserProfileAssociation(provider, bucket),
    setBrowserProfileAssociation: (provider, bucket, association) =>
      manager().setBrowserProfileAssociation(provider, bucket, association),
    getAllAnthropicUsageInfo: () => manager().getAllAnthropicUsageInfo(),
    getAllCodexUsageInfo: () => manager().getAllCodexUsageInfo(),
    getAllCodexRateLimitResetCredits: () =>
      manager().getAllCodexRateLimitResetCredits(),
    hasCodexToken: async () => (await manager().getToken('codex')) !== null,
    attachProviderMessages: (callback) =>
      manager().attachAddItemToProviders(callback),
    submitCode: (provider, code) => {
      const oauthProvider = manager().getProvider(provider);
      if (
        !oauthProvider ||
        !('submitAuthCode' in oauthProvider) ||
        typeof oauthProvider.submitAuthCode !== 'function'
      )
        return false;
      oauthProvider.submitAuthCode(code);
      return true;
    },
  };
}
