/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2891 (FIX 2): OAuth provider registration hazards.
 *
 * Two latent defects contributed to `claudecode` appearing unauthenticated:
 *
 *  1. `ensureOAuthProviderRegistered` keeps a per-manager dedup set. A provider
 *     first registered WITHOUT an `addItem` UI callback could never receive one
 *     later, because the second call short-circuited on the dedup set. The UI
 *     callback was silently lost for the lifetime of the manager.
 *
 *  2. When no token store is reachable the provider is not registered at all.
 *     `TokenAccessCoordinator.getToken()` then returns null immediately because
 *     `providerRegistry.getProvider('claudecode')` is falsy — presenting as
 *     "not authenticated" even with a valid persisted token.
 *
 * These tests exercise the real `ensureOAuthProviderRegistered` and the real
 * `AnthropicOAuthProvider`; only the manager is a local fake, so that provider
 * registration is observable.
 */

import { describe, it, expect, beforeEach } from 'bun:test';

import type { OAuthProvider, TokenStore } from '../../auth/index.js';
import type { OAuthUICallback } from '@vybestack/llxprt-code-auth';
import {
  ensureOAuthProviderRegistered,
  isOAuthProviderRegistered,
  resetRegisteredProviders,
} from '../oauth-provider-registration.js';

/**
 * Minimal in-memory token store. Registration only needs to hold a reference,
 * so the methods are never exercised by these tests.
 */
function makeTokenStore(): TokenStore {
  return {
    saveToken: async () => {},
    getToken: async () => null,
    removeToken: async () => {},
    listProviders: async () => [],
  } as unknown as TokenStore;
}

/**
 * Local fake manager: records registered providers so registration is
 * observable. Mirrors the `OAuthRegistrationManager` structural type.
 */
class FakeOAuthManager {
  readonly providers = new Map<string, OAuthProvider>();
  private readonly tokenStore?: TokenStore;

  constructor(tokenStore?: TokenStore) {
    this.tokenStore = tokenStore;
  }

  registerProvider(provider: OAuthProvider): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name: string): OAuthProvider | undefined {
    return this.providers.get(name);
  }

  // Only present when a store was supplied, so the "no store reachable"
  // case can be represented faithfully.
  getTokenStore?: () => TokenStore;

  static withTokenStore(tokenStore: TokenStore): FakeOAuthManager {
    const manager = new FakeOAuthManager(tokenStore);
    manager.getTokenStore = () => tokenStore;
    return manager;
  }
}

/** Read the provider's captured UI callback without altering behavior. */
function readAddItem(provider: OAuthProvider): OAuthUICallback | undefined {
  return (provider as unknown as { addItem?: OAuthUICallback }).addItem;
}

describe('Issue #2891 FIX 2 - ensureOAuthProviderRegistered', () => {
  beforeEach(() => {
    resetRegisteredProviders();
  });

  it('attaches a later-supplied addItem to the ALREADY-registered provider', () => {
    const manager = new FakeOAuthManager();
    const tokenStore = makeTokenStore();

    // First registration happens before the UI exists, so there is no addItem.
    ensureOAuthProviderRegistered('claudecode', manager, tokenStore, undefined);

    const firstInstance = manager.getProvider('claudecode');
    expect(firstInstance).toBeDefined();
    expect(readAddItem(firstInstance!)).toBeUndefined();

    // Later, once the UI is available, the callback is supplied.
    const addItem: OAuthUICallback = (() => {
      // Identity is what matters here; the body is never invoked.
    }) as unknown as OAuthUICallback;

    ensureOAuthProviderRegistered('claudecode', manager, tokenStore, addItem);

    const secondInstance = manager.getProvider('claudecode');

    // The provider must NOT be re-registered or replaced...
    expect(secondInstance).toBe(firstInstance!);
    // ...but it MUST now carry the callback. Before the fix this was dropped.
    expect(readAddItem(secondInstance!)).toBe(addItem);
  });

  it('registers the provider when the token store is reachable only via getTokenStore()', () => {
    const tokenStore = makeTokenStore();
    const manager = FakeOAuthManager.withTokenStore(tokenStore);

    // Caller passes `undefined`; the manager fallback must supply the store.
    ensureOAuthProviderRegistered('claudecode', manager, undefined, undefined);

    expect(isOAuthProviderRegistered('claudecode', manager)).toBe(true);
    expect(manager.getProvider('claudecode')).toBeDefined();
  });

  it('does NOT register the provider when no token store is reachable', () => {
    const manager = new FakeOAuthManager();

    ensureOAuthProviderRegistered('claudecode', manager, undefined, undefined);

    // This is the state that makes TokenAccessCoordinator.getToken() return
    // null immediately, presenting as "not authenticated".
    expect(isOAuthProviderRegistered('claudecode', manager)).toBe(false);
    expect(manager.getProvider('claudecode')).toBeUndefined();
  });

  it('leaves unknown provider names unregistered', () => {
    const tokenStore = makeTokenStore();
    const manager = new FakeOAuthManager();

    ensureOAuthProviderRegistered('not-a-provider', manager, tokenStore);

    expect(isOAuthProviderRegistered('not-a-provider', manager)).toBe(false);
    expect(manager.providers.size).toBe(0);
  });
});
