/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for Gemini OAuth fallback behavior when browser cannot be opened
 * This should match the behavior of Anthropic OAuth provider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiOAuthProvider } from '../../src/auth/gemini-oauth-provider.js';
import { KeyringTokenStore } from '@vybestack/llxprt-code-core';
import { HistoryItemWithoutId } from '../../src/ui/types.js';

describe('GeminiOAuthProvider - Fallback Dialog', () => {
  let provider: GeminiOAuthProvider;
  let tokenStore: KeyringTokenStore;
  let addItemSpy: ReturnType<typeof vi.fn>;
  let historyItems: HistoryItemWithoutId[];

  beforeEach(() => {
    historyItems = [];
    addItemSpy = vi.fn((item: HistoryItemWithoutId) => {
      historyItems.push(item);
      return historyItems.length;
    });

    tokenStore = {
      saveToken: vi.fn(),
      getToken: vi.fn().mockResolvedValue(null),
      clearToken: vi.fn(),
    } as unknown as KeyringTokenStore;

    provider = new GeminiOAuthProvider(tokenStore, addItemSpy);
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Clean up global flags
    delete (global as { __oauth_provider?: unknown }).__oauth_provider;
    delete (global as { __oauth_needs_code?: unknown }).__oauth_needs_code;
    delete (global as { __oauth_wait_for_code?: unknown })
      .__oauth_wait_for_code;
  });

  describe('Fallback methods availability', () => {
    it('should provide waitForAuthCode method like Anthropic provider', () => {
      expect(provider).toHaveProperty('waitForAuthCode');
      expect(typeof provider.waitForAuthCode).toBe('function');
    });

    it('should provide submitAuthCode method like Anthropic provider', () => {
      expect(provider).toHaveProperty('submitAuthCode');
      expect(typeof provider.submitAuthCode).toBe('function');
    });

    it('should provide cancelAuth method like Anthropic provider', () => {
      expect(provider).toHaveProperty('cancelAuth');
      expect(typeof provider.cancelAuth).toBe('function');
    });
  });

  describe('submitAuthCode and cancelAuth behavior', () => {
    it('should reject pending promise when cancelAuth is called', async () => {
      // Create a pending auth code promise
      const authCodePromise = provider.waitForAuthCode();

      // Cancel should reject the promise
      provider.cancelAuth();

      await expect(authCodePromise).rejects.toThrow(/cancel/i);
    });

    it('should resolve pending promise when submitAuthCode is called', async () => {
      // Create a pending auth code promise
      const authCodePromise = provider.waitForAuthCode();

      // Submit code should resolve the promise
      const testCode = 'test-auth-code';
      provider.submitAuthCode(testCode);

      const result = await authCodePromise;
      expect(result).toBe(testCode);
    });

    it('should handle multiple cancel calls gracefully', () => {
      // First cancel creates and cancels
      provider.waitForAuthCode().catch(() => {}); // Ignore rejection
      provider.cancelAuth();

      // Second cancel should not throw
      expect(() => provider.cancelAuth()).not.toThrow();
    });

    it('should handle submitAuthCode without pending promise', () => {
      // Should not throw when there's no pending promise
      expect(() => provider.submitAuthCode('test-code')).not.toThrow();
    });
  });

  describe('Fallback flow integration', () => {
    it('should set up auth code resolver when waitForAuthCode is called', async () => {
      const authPromise = provider.waitForAuthCode();

      // Submit a code
      setTimeout(() => {
        provider.submitAuthCode('integration-test-code');
      }, 10);

      const result = await authPromise;
      expect(result).toBe('integration-test-code');
    });

    it('should only resolve once even with multiple submits', async () => {
      const authPromise = provider.waitForAuthCode();

      provider.submitAuthCode('first-code');
      provider.submitAuthCode('second-code'); // Should be ignored

      const result = await authPromise;
      expect(result).toBe('first-code');
    });
  });

  describe('Persistent auth code hook installation (Issue #1370)', () => {
    it('should install __oauth_wait_for_code hook on construction', () => {
      const hook = (global as Record<string, unknown>).__oauth_wait_for_code;
      expect(hook).toBeDefined();
      expect(typeof hook).toBe('function');
    });

    it('should set __oauth_provider to gemini on construction', () => {
      expect((global as Record<string, unknown>).__oauth_provider).toBe(
        'gemini',
      );
    });

    it('should not overwrite an existing __oauth_wait_for_code hook', () => {
      const existingHook = vi.fn();
      (global as Record<string, unknown>).__oauth_wait_for_code = existingHook;

      // Create a new provider — should NOT overwrite
      const newProvider = new GeminiOAuthProvider(tokenStore, addItemSpy);
      expect((global as Record<string, unknown>).__oauth_wait_for_code).toBe(
        existingHook,
      );

      // Suppress unused-variable warning
      void newProvider;
    });

    it('should provide a working auth code flow through the persistent hook', async () => {
      const hook = (global as Record<string, unknown>)
        .__oauth_wait_for_code as () => Promise<string>;
      const codePromise = hook();

      // Simulate UI submitting the code
      provider.submitAuthCode('test-code-1370');

      const result = await codePromise;
      expect(result).toBe('test-code-1370');
    });
  });
});
