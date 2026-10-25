/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type {
  OAuthAuthOutcome,
  OAuthUICallback,
} from '@vybestack/llxprt-code-auth';
import type { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type { DiscoveredProvider } from './oauth-bucket-discovery.js';
import { discoverProviderBuckets } from './oauth-bucket-discovery.js';

export type AgentSessionAuthentication = Pick<
  OAuthManager,
  | 'attachInteractiveAuthMessages'
  | 'bindInteractiveAuthHost'
  | 'unbindInteractiveAuthHost'
  | 'cancelInteractiveAuth'
  | 'getInteractiveAuthSessions'
  | 'takeAuthOutcome'
  | 'getCodeRequest'
  | 'clearCodeRequest'
  | 'getDialog'
  | 'subscribeDialog'
  | 'dismissDialog'
  | 'getAuthStatus'
  | 'toggleOAuthEnabled'
  | 'authenticate'
  | 'getSupportedProviders'
  | 'listBuckets'
  | 'isOAuthEnabled'
  | 'isAuthenticated'
  | 'peekStoredToken'
  | 'getHigherPriorityAuth'
  | 'activateNamedLoginBucket'
  | 'logoutAllBuckets'
  | 'logout'
  | 'clearSessionBucket'
  | 'getAuthStatusWithBuckets'
  | 'setSessionBucket'
  | 'getSessionBucket'
  | 'inspectAuthLock'
  | 'forceRecoverAuthLock'
  | 'recoverAuthLock'
  | 'clearBrowserProfileAssociation'
  | 'setBrowserProfileAssociation'
  | 'resetBuckets'
  | 'ensureBucketsAuthenticated'
  | 'readFailoverBuckets'
  | 'getAllAnthropicUsageInfo'
  | 'getAllCodexUsageInfo'
  | 'getAllCodexRateLimitResetCredits'
> & {
  hasCodexToken(): Promise<boolean>;
  clearProviderClientCache(provider: string): void;
  isAvailable(): boolean;
  discoverBuckets(logger?: DebugLogger): Promise<DiscoveredProvider[]>;
  readStoredTokenSummary(
    provider: string,
    bucket: string,
  ): Promise<{ expiry?: number; hasRefreshToken: boolean } | null>;
  readCodexBucketToken(bucket: string): Promise<unknown>;
  attachProviderMessages(callback: OAuthUICallback): void;
  submitCode(provider: string, code: string): boolean;
};

function interactiveHostControl(
  oauth: OAuthManager | undefined,
): Pick<
  AgentSessionAuthentication,
  | 'attachInteractiveAuthMessages'
  | 'bindInteractiveAuthHost'
  | 'unbindInteractiveAuthHost'
  | 'cancelInteractiveAuth'
  | 'getInteractiveAuthSessions'
  | 'takeAuthOutcome'
  | 'getCodeRequest'
  | 'clearCodeRequest'
  | 'getDialog'
  | 'subscribeDialog'
  | 'dismissDialog'
> {
  const manager = (): OAuthManager => requireOAuthManager(oauth);
  return {
    attachInteractiveAuthMessages: (callback) =>
      manager().attachInteractiveAuthMessages(callback),
    bindInteractiveAuthHost: (handler) =>
      manager().bindInteractiveAuthHost(handler),
    unbindInteractiveAuthHost: () => manager().unbindInteractiveAuthHost(),
    cancelInteractiveAuth: () => manager().cancelInteractiveAuth(),
    getInteractiveAuthSessions: () => manager().getInteractiveAuthSessions(),
    takeAuthOutcome: (): OAuthAuthOutcome => manager().takeAuthOutcome(),
    getCodeRequest: () => manager().getCodeRequest(),
    clearCodeRequest: () => manager().clearCodeRequest(),
    getDialog: () => manager().getDialog(),
    subscribeDialog: (listener) => manager().subscribeDialog(listener),
    dismissDialog: (id) => manager().dismissDialog(id),
  };
}

export function assembleSessionAuthentication(
  oauth: OAuthManager | undefined,
  clearProviderClientCache: (provider: string) => void,
): AgentSessionAuthentication {
  const manager = (): OAuthManager => {
    const current = oauth;
    if (!(current instanceof OAuthManager))
      throw new Error('OAuth runtime infrastructure is unavailable.');
    return current;
  };
  return {
    ...interactiveHostControl(oauth),
    clearProviderClientCache,
    isAvailable: () => oauth instanceof OAuthManager,
    discoverBuckets: (logger) => discoverProviderBuckets(manager(), logger),
    ...storedTokenOperations((provider, bucket) =>
      manager().getTokenStore().getToken(provider, bucket),
    ),
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
    getAllAnthropicUsageInfo: (requestFetch) =>
      manager().getAllAnthropicUsageInfo(requestFetch),
    getAllCodexUsageInfo: (requestFetch) =>
      manager().getAllCodexUsageInfo(requestFetch),
    getAllCodexRateLimitResetCredits: (requestFetch) =>
      manager().getAllCodexRateLimitResetCredits(requestFetch),
    resetBuckets: (provider, clearSession) =>
      manager().resetBuckets(provider, clearSession),
    ensureBucketsAuthenticated: (provider) =>
      manager().ensureBucketsAuthenticated(provider),
    readFailoverBuckets: (provider) => manager().readFailoverBuckets(provider),
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

function requireOAuthManager(oauth: OAuthManager | undefined): OAuthManager {
  if (!(oauth instanceof OAuthManager))
    throw new Error('OAuth runtime infrastructure is unavailable.');
  return oauth;
}

export function clearProviderAuthenticationCache(provider: unknown): void {
  if (
    provider !== null &&
    typeof provider === 'object' &&
    'clearClientCache' in provider &&
    typeof provider.clearClientCache === 'function'
  )
    provider.clearClientCache();
}

function storedTokenOperations(
  readToken: ReturnType<OAuthManager['getTokenStore']>['getToken'],
): Pick<
  AgentSessionAuthentication,
  'readStoredTokenSummary' | 'readCodexBucketToken'
> {
  return {
    readStoredTokenSummary: async (provider, bucket) => {
      const token = await readToken(provider, bucket);
      if (!token) return null;
      return {
        ...(typeof token.expiry === 'number' ? { expiry: token.expiry } : {}),
        hasRefreshToken: Boolean(token.refresh_token),
      };
    },
    readCodexBucketToken: (bucket) => readToken('codex', bucket),
  };
}
