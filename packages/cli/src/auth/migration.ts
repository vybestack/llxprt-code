/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250823-AUTHFIXES.P16
 * @requirement REQ-004.2
 * Migration utilities for OAuth token storage modernization
 *
 * This module handles migration of tokens from legacy storage formats
 * to the new standardized TokenStore persistence system.
 */

import { OAuthProvider } from './oauth-manager.js';
import { TokenStore } from '@vybestack/llxprt-code-core';

/**
 * Migrate any in-memory tokens to persistent storage
 *
 * @param providers - Map of OAuth provider instances
 * @param tokenStore - Token persistence store
 */
export async function migrateInMemoryTokens(
  providers: Map<string, OAuthProvider>,
  tokenStore: TokenStore,
): Promise<void> {
  for (const [name, provider] of providers) {
    try {
      // Check for in-memory token
      const token = await provider.getToken();
      if (token) {
        const stored = await tokenStore.getToken(name);
        if (!stored) {
          // Migrate to storage
          await tokenStore.saveToken(name, token);
          console.log(`Migrated ${name} token to persistent storage`);
        }
      }
    } catch (_error) {
      // Skip providers that don't have valid tokens
      // This is expected during normal operation
      continue;
    }
  }
}

/**
 * Display migration notice to users about OAuth token storage changes
 */
export function showMigrationNotice(): void {
  console.log(`
LLXPRT OAuth Token Storage Migration
====================================

Your OAuth tokens are now stored in standardized locations:
- Anthropic: ~/.llxprt/oauth/anthropic.json
- Gemini: ~/.llxprt/oauth/gemini.json  
- Qwen: ~/.llxprt/oauth/qwen.json

If you experience authentication issues, please re-login:
- llxprt auth login anthropic
- llxprt auth login gemini
- llxprt auth login qwen

Legacy Gemini tokens in ~/.llxprt/oauth_creds.json are no longer used.
`);
}
