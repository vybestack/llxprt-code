/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createContext,
  useContext,
  type PropsWithChildren,
  type JSX,
} from 'react';
import type { OAuthUICallback } from '@vybestack/llxprt-code-auth';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type { DiscoveredProvider } from '../commands/oauthBucketDiscovery.js';

export type OAuthControl = Pick<
  OAuthManager,
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

const OAuthControlContext = createContext<OAuthControl | null>(null);

export function OAuthControlProvider({
  control,
  children,
}: PropsWithChildren<{ control: OAuthControl }>): JSX.Element {
  return (
    <OAuthControlContext.Provider value={control}>
      {children}
    </OAuthControlContext.Provider>
  );
}

export function useOAuthControl(): OAuthControl {
  const control = useContext(OAuthControlContext);
  if (!control)
    throw new Error('OAuthControlProvider is missing from the component tree.');
  return control;
}
