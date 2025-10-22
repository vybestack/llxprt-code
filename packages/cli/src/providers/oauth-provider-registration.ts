/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GeminiOAuthProvider } from '../auth/gemini-oauth-provider.js';
import { QwenOAuthProvider } from '../auth/qwen-oauth-provider.js';
import { AnthropicOAuthProvider } from '../auth/anthropic-oauth-provider.js';
import { MultiProviderTokenStore } from '../auth/types.js';
import { OAuthManager } from '../auth/oauth-manager.js';
import { HistoryItemWithoutId } from '../ui/types.js';

/**
 * Track which OAuth providers have been registered to avoid duplicate registration
 */
let registeredProviders = new Set<string>();

/**
 * Context-aware OAuth provider registration
 * Only registers OAuth providers when actually needed for specific providers
 */
export function ensureOAuthProviderRegistered(
  providerName: string,
  oauthManager: OAuthManager,
  tokenStore: MultiProviderTokenStore,
  addItem?: (
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp: number,
  ) => number,
): void {
  if (registeredProviders.has(providerName) || !oauthManager) {
    return;
  }

  let oauthProvider = null;

  switch (providerName) {
    case 'gemini':
      oauthProvider = new GeminiOAuthProvider(tokenStore);
      break;
    case 'qwen':
      oauthProvider = new QwenOAuthProvider(tokenStore);
      break;
    case 'anthropic':
      oauthProvider = new AnthropicOAuthProvider(tokenStore);
      break;
    default:
      return; // No OAuth provider needed for this provider name
  }

  if (oauthProvider && addItem) {
    oauthProvider.setAddItem?.(addItem);
  }

  if (oauthProvider) {
    oauthManager.registerProvider(oauthProvider);
    registeredProviders.add(providerName);
  }
}

/**
 * Check if an OAuth provider has been registered
 */
export function isOAuthProviderRegistered(providerName: string): boolean {
  return registeredProviders.has(providerName);
}

/**
 * Reset registered providers (mainly for testing)
 */
export function resetRegisteredProviders(): void {
  registeredProviders = new Set();
}
