/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core';
import { GeminiOAuthProvider } from '../auth/gemini-oauth-provider.js';
import { QwenOAuthProvider } from '../auth/qwen-oauth-provider.js';
import { AnthropicOAuthProvider } from '../auth/anthropic-oauth-provider.js';
import { MultiProviderTokenStore } from '../auth/types.js';
import { OAuthManager } from '../auth/oauth-manager.js';
import { HistoryItemWithoutId } from '../ui/types.js';

/**
 * Track which OAuth providers have been registered to avoid duplicate registration
 */
const oauthLogger = new DebugLogger('llxprt:oauth:registration');

let registeredProviders = new WeakMap<OAuthManager, Set<string>>();

/**
 * Context-aware OAuth provider registration
 * Only registers OAuth providers when actually needed for specific providers
 */
export function ensureOAuthProviderRegistered(
  providerName: string,
  oauthManager: OAuthManager,
  tokenStore?: MultiProviderTokenStore,
  addItem?: (
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp: number,
  ) => number,
): void {
  if (!oauthManager) {
    return;
  }

  let registered = registeredProviders.get(oauthManager);
  if (!registered) {
    registered = new Set<string>();
    registeredProviders.set(oauthManager, registered);
  }
  if (registered.has(providerName)) {
    return;
  }

  const effectiveTokenStore = tokenStore ?? oauthManager.getTokenStore?.();
  if (!effectiveTokenStore) {
    oauthLogger.debug(
      () =>
        `Token store unavailable for '${providerName}'; skipping OAuth provider registration`,
    );
    return;
  }

  let oauthProvider = null;

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
    default:
      return; // No OAuth provider needed for this provider name
  }

  // Note: setAddItem is still called as a fallback for providers that don't accept it in constructor
  if (oauthProvider && addItem) {
    oauthProvider.setAddItem?.(addItem);
  }

  if (oauthProvider) {
    oauthLogger.debug(() => `Registering OAuth provider '${providerName}'`);
    oauthManager.registerProvider(oauthProvider);
    registered.add(providerName);
  }
}

/**
 * Check if an OAuth provider has been registered
 */
export function isOAuthProviderRegistered(
  providerName: string,
  oauthManager: OAuthManager,
): boolean {
  return registeredProviders.get(oauthManager)?.has(providerName) ?? false;
}

/**
 * Reset registered providers (mainly for testing)
 */
export function resetRegisteredProviders(): void {
  registeredProviders = new WeakMap();
}
