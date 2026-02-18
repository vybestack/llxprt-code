/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Migration completeness tests for Phase 35.
 *
 * These tests verify that all instantiation sites have been properly migrated
 * to use factory functions, ensuring the credential proxy architecture is
 * correctly wired throughout the codebase.
 *
 * @plan:PLAN-20250214-CREDPROXY.P35
 * @requirement R2.3, R12.5, R26.1
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTokenStore,
  createProviderKeyStorage,
  resetFactorySingletons,
} from '../credential-store-factory.js';
import {
  KeyringTokenStore,
  mergeRefreshedToken,
} from '@vybestack/llxprt-code-core';

describe('Migration Completeness (P35)', () => {
  beforeEach(() => {
    // Clean up environment and singletons before each test
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    resetFactorySingletons();
  });

  afterEach(() => {
    // Clean up environment after each test
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    resetFactorySingletons();
  });

  describe('R2.3: Factory Usage at Consumer Sites', () => {
    it('createTokenStore returns KeyringTokenStore when env unset (non-sandbox)', () => {
      // R26.1: Non-sandbox mode behavior identical to pre-Phase code
      const tokenStore = createTokenStore();

      // Should be a KeyringTokenStore instance in non-sandbox mode
      expect(tokenStore).toBeDefined();
      expect(tokenStore).toBeInstanceOf(KeyringTokenStore);
    });

    it('createProviderKeyStorage returns direct storage when env unset (non-sandbox)', () => {
      // R26.1: Non-sandbox mode behavior identical to pre-Phase code
      const keyStorage = createProviderKeyStorage();

      // Should return the direct ProviderKeyStorage singleton
      expect(keyStorage).toBeDefined();
      expect(typeof keyStorage.getKey).toBe('function');
      expect(typeof keyStorage.saveKey).toBe('function');
      expect(typeof keyStorage.deleteKey).toBe('function');
    });

    it('factory returns same singleton on repeated calls (non-sandbox)', () => {
      const tokenStore1 = createTokenStore();
      const tokenStore2 = createTokenStore();

      expect(tokenStore1).toBe(tokenStore2);

      const keyStorage1 = createProviderKeyStorage();
      const keyStorage2 = createProviderKeyStorage();

      expect(keyStorage1).toBe(keyStorage2);
    });
  });

  describe('R12.5: mergeRefreshedToken Extraction', () => {
    // Base token that satisfies OAuthTokenWithExtras requirements
    const baseToken = {
      access_token: 'old_access',
      refresh_token: 'preserved_refresh',
      expiry: 1700000000,
      token_type: 'Bearer' as const,
    };

    it('mergeRefreshedToken is exported from core', () => {
      // Verify the shared utility is exported from core
      expect(mergeRefreshedToken).toBeDefined();
      expect(typeof mergeRefreshedToken).toBe('function');
    });

    it('mergeRefreshedToken preserves refresh_token when not in new token', () => {
      const current = { ...baseToken };
      const next = {
        access_token: 'new_access',
        expiry: 1700001000,
        // No refresh_token
      };

      const merged = mergeRefreshedToken(current, next);

      expect(merged.access_token).toBe('new_access');
      expect(merged.refresh_token).toBe('preserved_refresh');
      expect(merged.expiry).toBe(1700001000);
    });

    it('mergeRefreshedToken uses new refresh_token when provided', () => {
      const current = { ...baseToken, refresh_token: 'old_refresh' };
      const next = {
        access_token: 'new_access',
        refresh_token: 'new_refresh',
        expiry: 1700001000,
      };

      const merged = mergeRefreshedToken(current, next);

      expect(merged.access_token).toBe('new_access');
      expect(merged.refresh_token).toBe('new_refresh');
      expect(merged.expiry).toBe(1700001000);
    });

    it('mergeRefreshedToken preserves refresh_token when empty string in new token', () => {
      const current = { ...baseToken };
      const next = {
        access_token: 'new_access',
        refresh_token: '',
        expiry: 1700001000,
      };

      const merged = mergeRefreshedToken(current, next);

      expect(merged.access_token).toBe('new_access');
      expect(merged.refresh_token).toBe('preserved_refresh');
    });
  });

  describe('R26.1: Non-Sandbox Mode Unchanged', () => {
    it('TokenStore has all expected methods in non-sandbox mode', () => {
      const tokenStore = createTokenStore();

      // Verify the interface is complete (TokenStore interface)
      expect(typeof tokenStore.getToken).toBe('function');
      expect(typeof tokenStore.saveToken).toBe('function');
      expect(typeof tokenStore.removeToken).toBe('function');
      expect(typeof tokenStore.listBuckets).toBe('function');
      expect(typeof tokenStore.listProviders).toBe('function');
    });

    it('ProviderKeyStorage has all expected methods in non-sandbox mode', () => {
      const keyStorage = createProviderKeyStorage();

      // Verify the interface is complete (ProviderKeyStorage class)
      expect(typeof keyStorage.getKey).toBe('function');
      expect(typeof keyStorage.saveKey).toBe('function');
      expect(typeof keyStorage.deleteKey).toBe('function');
      expect(typeof keyStorage.listKeys).toBe('function');
      expect(typeof keyStorage.hasKey).toBe('function');
    });
  });

  describe('Token Merge Contract Consistency', () => {
    // Base token that satisfies OAuthTokenWithExtras requirements
    const baseToken = {
      access_token: 'old_access',
      refresh_token: 'old_refresh',
      expiry: 1700000000,
      token_type: 'Bearer' as const,
    };

    it('mergeRefreshedToken handles extra properties', () => {
      const current = {
        ...baseToken,
        custom_field: 'preserved',
      };

      const next = {
        access_token: 'new_access',
        expiry: 1700001000,
        another_field: 'added',
      };

      const merged = mergeRefreshedToken(current, next);

      expect(merged.access_token).toBe('new_access');
      expect(merged.refresh_token).toBe('old_refresh');
      expect(merged.expiry).toBe(1700001000);
      expect(merged.custom_field).toBe('preserved');
      expect(merged.another_field).toBe('added');
    });

    it('mergeRefreshedToken is pure (does not mutate inputs)', () => {
      const current = { ...baseToken };
      const next = {
        access_token: 'new_access',
        expiry: 1700001000,
      };

      // Make deep copies to compare after
      const currentCopy = JSON.parse(JSON.stringify(current));
      const nextCopy = JSON.parse(JSON.stringify(next));

      mergeRefreshedToken(current, next);

      // Originals should be unchanged
      expect(current).toEqual(currentCopy);
      expect(next).toEqual(nextCopy);
    });
  });
});
