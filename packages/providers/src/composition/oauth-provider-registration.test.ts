/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerStandardOAuthProviders,
  isOAuthProviderRegistered,
  resetRegisteredProviders,
} from './oauth-provider-registration.js';
import { OAuthManager, createTokenStore } from '../auth/index.js';
import type { OAuthManager as OAuthManagerType } from '../auth/index.js';

function createFreshManager(): OAuthManagerType {
  const tokenStore = createTokenStore();
  return new OAuthManager(tokenStore);
}

describe('registerStandardOAuthProviders', () => {
  beforeEach(() => {
    resetRegisteredProviders();
  });

  it('registers gemini, anthropic, and codex on a fresh manager', () => {
    const oauthManager = createFreshManager();

    expect(oauthManager.getSupportedProviders()).toStrictEqual([]);

    registerStandardOAuthProviders(oauthManager, oauthManager.getTokenStore());

    expect(oauthManager.getSupportedProviders().sort()).toStrictEqual([
      'anthropic',
      'codex',
      'gemini',
    ]);
  });

  it('does not duplicate providers when called twice on the same manager', () => {
    const oauthManager = createFreshManager();

    registerStandardOAuthProviders(oauthManager, oauthManager.getTokenStore());
    registerStandardOAuthProviders(oauthManager, oauthManager.getTokenStore());

    expect(oauthManager.getSupportedProviders().sort()).toStrictEqual([
      'anthropic',
      'codex',
      'gemini',
    ]);
  });

  it('registers providers when tokenStore is passed explicitly', () => {
    const oauthManager = createFreshManager();
    const explicitTokenStore = createTokenStore();

    registerStandardOAuthProviders(oauthManager, explicitTokenStore);

    expect(isOAuthProviderRegistered('gemini', oauthManager)).toBe(true);
    expect(isOAuthProviderRegistered('anthropic', oauthManager)).toBe(true);
    expect(isOAuthProviderRegistered('codex', oauthManager)).toBe(true);
  });

  it('registers providers using tokenStore from the oauthManager when none is passed', () => {
    const oauthManager = createFreshManager();

    registerStandardOAuthProviders(oauthManager);

    expect(oauthManager.getSupportedProviders().sort()).toStrictEqual([
      'anthropic',
      'codex',
      'gemini',
    ]);
  });
});
