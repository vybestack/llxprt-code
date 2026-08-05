/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20250214-CREDPROXY.P33
 */

import { DebugLogger } from '@vybestack/llxprt-code-core';
import { AnthropicOAuthProvider, CodexOAuthProvider } from '../auth/index.js';
import type { OAuthProvider, TokenStore, OAuthManager } from '../auth/index.js';
import type { OAuthUICallback } from '@vybestack/llxprt-code-auth';

type AddItemCallback = OAuthUICallback;

type OAuthProviderWithAddItem = OAuthProvider & {
  setAddItem?: (addItem: AddItemCallback) => void;
};

type OAuthRegistrationManager = Pick<
  OAuthManager,
  'registerProvider' | 'getProvider'
> & {
  getTokenStore?: () => TokenStore;
};

/**
 * Track which OAuth providers have been registered to avoid duplicate registration
 */
const oauthLogger = new DebugLogger('llxprt:oauth:registration');

let registeredProviders = new WeakMap<OAuthRegistrationManager, Set<string>>();

/**
 * Context-aware OAuth provider registration
 * Only registers OAuth providers when actually needed for specific providers
 */
export function ensureOAuthProviderRegistered(
  providerName: string,
  oauthManager: OAuthRegistrationManager,
  tokenStore?: TokenStore,
  addItem?: AddItemCallback,
): void {
  let registered = registeredProviders.get(oauthManager);
  if (!registered) {
    registered = new Set<string>();
    registeredProviders.set(oauthManager, registered);
  }
  if (registered.has(providerName)) {
    // The provider is already registered, but a later call may carry an
    // `addItem` UI callback that the first registration lacked. Attach it to
    // the existing provider rather than silently dropping it (issue #2891).
    if (addItem) {
      oauthManager.getProvider(providerName)?.setAddItem?.(addItem);
    }
    return;
  }

  const effectiveTokenStore = tokenStore ?? oauthManager.getTokenStore?.();
  if (effectiveTokenStore === undefined) {
    // Previously a silent `debug` log: a missing token store leaves the
    // provider unregistered, which then makes TokenAccessCoordinator.getToken()
    // return null immediately. Surface this as a warning so it is observable.
    oauthLogger.warn(
      () =>
        `Token store unavailable for '${providerName}'; OAuth provider registration skipped`,
    );
    return;
  }

  let oauthProvider: OAuthProviderWithAddItem;

  switch (providerName) {
    case 'claudecode':
      oauthProvider = new AnthropicOAuthProvider(effectiveTokenStore, addItem);
      break;
    case 'codex':
      oauthProvider = new CodexOAuthProvider(effectiveTokenStore, addItem);
      break;
    default:
      return; // No OAuth provider needed for this provider name
  }

  // Note: setAddItem is still called as a fallback for providers that don't accept it in constructor
  if (addItem) {
    oauthProvider.setAddItem?.(addItem);
  }

  oauthLogger.debug(() => `Registering OAuth provider '${providerName}'`);
  oauthManager.registerProvider(oauthProvider);
  registered.add(providerName);
}

/**
 * Register the standard OAuth providers (claudecode, codex) on an OAuthManager
 * instance. This is the canonical way to ensure a manager has the full provider
 * set available, regardless of which creation path produced it. Delegates to
 * ensureOAuthProviderRegistered for dedup and tokenStore handling.
 */
export function registerStandardOAuthProviders(
  oauthManager: OAuthRegistrationManager,
  tokenStore?: TokenStore,
  addItem?: AddItemCallback,
): void {
  ensureOAuthProviderRegistered(
    'claudecode',
    oauthManager,
    tokenStore,
    addItem,
  );
  ensureOAuthProviderRegistered('codex', oauthManager, tokenStore, addItem);
}

/**
 * Check if an OAuth provider has been registered
 */
export function isOAuthProviderRegistered(
  providerName: string,
  oauthManager: OAuthRegistrationManager,
): boolean {
  return registeredProviders.get(oauthManager)?.has(providerName) ?? false;
}

/**
 * Reset registered providers (mainly for testing)
 */
export function resetRegisteredProviders(): void {
  registeredProviders = new WeakMap<OAuthRegistrationManager, Set<string>>();
}
