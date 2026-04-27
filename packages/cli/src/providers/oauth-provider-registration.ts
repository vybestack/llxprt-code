/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20250214-CREDPROXY.P33
 */

import { DebugLogger } from '@vybestack/llxprt-code-core';
import { GeminiOAuthProvider } from '../auth/gemini-oauth-provider.js';
import { QwenOAuthProvider } from '../auth/qwen-oauth-provider.js';
import { AnthropicOAuthProvider } from '../auth/anthropic-oauth-provider.js';
import { CodexOAuthProvider } from '../auth/codex-oauth-provider.js';
import type { OAuthProvider, TokenStore } from '../auth/types.js';
import type { OAuthManager } from '../auth/oauth-manager.js';
import type { HistoryItemWithoutId } from '../ui/types.js';

type AddItemCallback = (
  itemData: Omit<HistoryItemWithoutId, 'id'>,
  baseTimestamp?: number,
) => number;

type OAuthProviderWithAddItem = OAuthProvider & {
  setAddItem?: (addItem: AddItemCallback) => void;
};

type OAuthRegistrationManager = Pick<OAuthManager, 'registerProvider'> & {
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
    return;
  }

  const effectiveTokenStore = tokenStore ?? oauthManager.getTokenStore?.();
  if (effectiveTokenStore === undefined) {
    oauthLogger.debug(
      () =>
        `Token store unavailable for '${providerName}'; skipping OAuth provider registration`,
    );
    return;
  }

  let oauthProvider: OAuthProviderWithAddItem;

  switch (providerName) {
    case 'gemini':
      oauthProvider = new GeminiOAuthProvider(effectiveTokenStore, addItem);
      break;
    case 'qwen':
      oauthProvider = new QwenOAuthProvider(effectiveTokenStore, addItem);
      break;
    case 'anthropic':
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
