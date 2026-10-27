/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { OAuthUICallback } from '@vybestack/llxprt-code-auth';
import type { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type { DiscoveredProvider } from './oauth-bucket-discovery.js';
import { discoverProviderBuckets } from './oauth-bucket-discovery.js';

const OAUTH_OPERATIONS = [
  'attachInteractiveAuthMessages',
  'bindInteractiveAuthHost',
  'unbindInteractiveAuthHost',
  'cancelInteractiveAuth',
  'getInteractiveAuthSessions',
  'takeAuthOutcome',
  'getCodeRequest',
  'clearCodeRequest',
  'getDialog',
  'subscribeDialog',
  'dismissDialog',
  'getAuthStatus',
  'toggleOAuthEnabled',
  'authenticate',
  'getSupportedProviders',
  'listBuckets',
  'isOAuthEnabled',
  'isAuthenticated',
  'peekStoredToken',
  'getHigherPriorityAuth',
  'activateNamedLoginBucket',
  'logoutAllBuckets',
  'logout',
  'clearSessionBucket',
  'getAuthStatusWithBuckets',
  'setSessionBucket',
  'getSessionBucket',
  'inspectAuthLock',
  'forceRecoverAuthLock',
  'recoverAuthLock',
  'clearBrowserProfileAssociation',
  'setBrowserProfileAssociation',
  'resetBuckets',
  'ensureBucketsAuthenticated',
  'readFailoverBuckets',
  'getAllAnthropicUsageInfo',
  'getAllCodexUsageInfo',
  'getAllCodexRateLimitResetCredits',
] as const satisfies ReadonlyArray<keyof OAuthManager>;

type OAuthOperations = Pick<OAuthManager, (typeof OAUTH_OPERATIONS)[number]>;
export type AgentSessionAuthentication = OAuthOperations & {
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

function bindAuthenticationOperations(oauth: OAuthManager): OAuthOperations;
function bindAuthenticationOperations(oauth: OAuthManager): object {
  return Object.fromEntries(
    OAUTH_OPERATIONS.map((name) => [name, oauth[name].bind(oauth)]),
  );
}

export function assembleSessionAuthentication(
  oauth: OAuthManager,
  clearProviderClientCache: (provider: string) => void,
): AgentSessionAuthentication {
  return {
    ...bindAuthenticationOperations(oauth),
    clearProviderClientCache,
    isAvailable: () => true,
    discoverBuckets: (logger) => discoverProviderBuckets(oauth, logger),
    ...storedTokenOperations((provider, bucket) =>
      oauth.getTokenStore().getToken(provider, bucket),
    ),
    hasCodexToken: async () => (await oauth.getToken('codex')) !== null,
    attachProviderMessages: (callback) =>
      oauth.attachAddItemToProviders(callback),
    submitCode: (provider, code) => {
      const oauthProvider = oauth.getProvider(provider);
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
